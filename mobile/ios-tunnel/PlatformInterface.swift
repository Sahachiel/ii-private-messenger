import NetworkExtension
import Network
import Libbox
import Darwin
import os

/// Collega sing-box (Libbox) al TUN della Network Extension di Apple.
/// Conforme a `LibboxPlatformInterfaceProtocol` per sing-box v1.11.1.
final class IIMsgPlatformInterface: NSObject, LibboxPlatformInterfaceProtocol {

    private weak var provider: NEPacketTunnelProvider?
    private let log = Logger(subsystem: "com.oleventechnologies.iiprivatemessenger.tunnel", category: "platform")
    private let monitorQueue = DispatchQueue(label: "com.oleventechnologies.iiprivatemessenger.tunnel.pathmonitor")
    private var pathMonitor: NWPathMonitor?

    init(provider: NEPacketTunnelProvider) {
        self.provider = provider
        super.init()
    }

    // MARK: - TUN

    func openTun(_ options: LibboxTunOptionsProtocol?,
                 ret0_: UnsafeMutablePointer<Int32>?) throws {
        guard let options, let provider else {
            throw err("openTun: missing options/provider")
        }
        let settings = try buildNetworkSettings(from: options)

        let sem = DispatchSemaphore(value: 0)
        var applyError: Error?
        provider.setTunnelNetworkSettings(settings) { e in
            applyError = e
            sem.signal()
        }
        sem.wait()
        if let applyError { throw applyError }

        let fd = tunFileDescriptor()
        guard fd >= 0 else { throw err("openTun: could not resolve utun fd") }
        ret0_?.pointee = fd
        log.info("openTun fd=\(fd)")
    }

    private func buildNetworkSettings(from options: LibboxTunOptionsProtocol) throws -> NEPacketTunnelNetworkSettings {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "127.0.0.1")
        settings.mtu = NSNumber(value: options.getMTU())

        var v4Addr: [String] = [], v4Mask: [String] = []
        if let it = options.getInet4Address() {
            while it.hasNext() {
                guard let p = it.next() else { continue }
                v4Addr.append(p.address())
                v4Mask.append(maskFromPrefix(p.prefix()))
            }
        }
        if !v4Addr.isEmpty {
            let ipv4 = NEIPv4Settings(addresses: v4Addr, subnetMasks: v4Mask)
            ipv4.includedRoutes = [NEIPv4Route.default()]
            settings.ipv4Settings = ipv4
        }

        var v6Addr: [String] = [], v6Prefix: [NSNumber] = []
        if let it = options.getInet6Address() {
            while it.hasNext() {
                guard let p = it.next() else { continue }
                v6Addr.append(p.address())
                v6Prefix.append(NSNumber(value: p.prefix()))
            }
        }
        if !v6Addr.isEmpty {
            let ipv6 = NEIPv6Settings(addresses: v6Addr, networkPrefixLengths: v6Prefix)
            ipv6.includedRoutes = [NEIPv6Route.default()]
            settings.ipv6Settings = ipv6
        }

        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]
        settings.dnsSettings = dns
        return settings
    }

    private func tunFileDescriptor() -> Int32 {
        guard let provider else { return -1 }
        if let fd = provider.packetFlow.value(forKeyPath: "socket.fileDescriptor") as? Int32 {
            return fd
        }
        return -1
    }

    private func maskFromPrefix(_ prefix: Int32) -> String {
        var mask = [Int](repeating: 0, count: 4)
        var bits = Int(prefix)
        for i in 0..<4 {
            let take = min(8, max(0, bits))
            mask[i] = take == 0 ? 0 : (0xFF << (8 - take)) & 0xFF
            bits -= take
        }
        return mask.map(String.init).joined(separator: ".")
    }

    // MARK: - Interface control / monitor

    func usePlatformAutoDetectControl() -> Bool { true }

    func autoDetectControl(_ fd: Int32) throws {
        // Il packet tunnel NE auto-esclude i propri socket; niente da bindare.
    }

    func startDefaultInterfaceMonitor(_ listener: LibboxInterfaceUpdateListenerProtocol?) throws {
        let monitor = NWPathMonitor()
        pathMonitor = monitor
        monitor.pathUpdateHandler = { path in
            let name = path.availableInterfaces.first?.name ?? ""
            let index = name.isEmpty ? 0 : Int32(bitPattern: if_nametoindex(name))
            listener?.updateDefaultInterface(name,
                                             interfaceIndex: index,
                                             isExpensive: path.isExpensive,
                                             isConstrained: path.isConstrained)
        }
        monitor.start(queue: monitorQueue)
    }

    func closeDefaultInterfaceMonitor(_ listener: LibboxInterfaceUpdateListenerProtocol?) throws {
        pathMonitor?.cancel()
        pathMonitor = nil
    }

    func getInterfaces() throws -> LibboxNetworkInterfaceIteratorProtocol {
        var result: [LibboxNetworkInterface] = []
        var addrsByName: [String: [String]] = [:]
        var flagsByName: [String: Int32] = [:]

        var ifap: UnsafeMutablePointer<ifaddrs>?
        if getifaddrs(&ifap) == 0, let first = ifap {
            defer { freeifaddrs(ifap) }
            var cur: UnsafeMutablePointer<ifaddrs>? = first
            while let node = cur {
                let ifa = node.pointee
                let name = String(cString: ifa.ifa_name)
                flagsByName[name] = Int32(bitPattern: ifa.ifa_flags)
                if let sa = ifa.ifa_addr {
                    let family = sa.pointee.sa_family
                    if family == UInt8(AF_INET) || family == UInt8(AF_INET6) {
                        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                        let len = socklen_t(family == UInt8(AF_INET)
                                            ? MemoryLayout<sockaddr_in>.size
                                            : MemoryLayout<sockaddr_in6>.size)
                        if getnameinfo(sa, len, &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                            addrsByName[name, default: []].append(String(cString: host))
                        }
                    }
                }
                cur = ifa.ifa_next
            }
        }

        for (name, addrs) in addrsByName {
            let ni = LibboxNetworkInterface()
            ni.name = name
            ni.index = Int32(bitPattern: if_nametoindex(name))
            ni.flags = flagsByName[name] ?? 0
            ni.addresses = IIMsgStringIterator(addrs)
            result.append(ni)
        }
        return IIMsgInterfaceIterator(result)
    }

    // MARK: - Environment flags

    func underNetworkExtension() -> Bool { true }
    func includeAllNetworks() -> Bool { false }
    func useProcFS() -> Bool { false }

    func readWIFIState() -> LibboxWIFIState? { nil }
    func clearDNSCache() {}

    func send(_ notification: LibboxNotification?) throws {
        // Nessuna notifica utente dal tunnel.
    }

    // MARK: - Process resolution (Android-only — non supportato su iOS)

    func findConnectionOwner(_ ipProtocol: Int32, sourceAddress: String?, sourcePort: Int32,
                             destinationAddress: String?, destinationPort: Int32,
                             ret0_: UnsafeMutablePointer<Int32>?) throws {
        throw err("findConnectionOwner unsupported on iOS")
    }

    func packageName(byUid uid: Int32, error: NSErrorPointer) -> String {
        error?.pointee = err("packageName unsupported on iOS")
        return ""
    }

    func uid(byPackageName packageName: String?,
             ret0_: UnsafeMutablePointer<Int32>?) throws {
        throw err("uidByPackageName unsupported on iOS")
    }

    func writeLog(_ message: String?) {
        if let message { log.info("\(message, privacy: .public)") }
    }

    private func err(_ msg: String) -> NSError {
        NSError(domain: "com.oleventechnologies.iiprivatemessenger.tunnel", code: 2,
                userInfo: [NSLocalizedDescriptionKey: msg])
    }
}

// MARK: - Iterator adapters

final class IIMsgStringIterator: NSObject, LibboxStringIteratorProtocol {
    private let items: [String]
    private var idx = 0
    init(_ items: [String]) { self.items = items }
    func hasNext() -> Bool { idx < items.count }
    func len() -> Int32 { Int32(items.count) }
    func next() -> String {
        defer { idx += 1 }
        return idx < items.count ? items[idx] : ""
    }
}

final class IIMsgInterfaceIterator: NSObject, LibboxNetworkInterfaceIteratorProtocol {
    private let items: [LibboxNetworkInterface]
    private var idx = 0
    init(_ items: [LibboxNetworkInterface]) { self.items = items }
    func hasNext() -> Bool { idx < items.count }
    func next() -> LibboxNetworkInterface? {
        defer { idx += 1 }
        return idx < items.count ? items[idx] : nil
    }
}
