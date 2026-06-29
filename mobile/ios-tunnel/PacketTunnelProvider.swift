import NetworkExtension
import Libbox
import os

/// II Private Messenger packet tunnel — esegue il core sing-box (Libbox) dentro la
/// Network Extension e lo collega al TUN di sistema. La config VLESS+REALITY arriva
/// dall'app (providerConfiguration["config"]), costruita dal proxy_config del backend.
///
/// NOTA: Libbox è un framework generato da gomobile; la sua API ObjC è sensibile alla
/// versione di sing-box (CI la pinna in scripts/build-libbox.sh). Se un errore di build
/// punta qui, verifica la firma contro gli header di Libbox pinnati.
final class PacketTunnelProvider: NEPacketTunnelProvider {

    private var boxService: LibboxBoxService?
    private var platform: IIMsgPlatformInterface?
    private let log = Logger(subsystem: "com.oleventechnologies.iiprivatemessenger.tunnel", category: "tunnel")

    override func startTunnel(options: [String: NSObject]?,
                             completionHandler: @escaping (Error?) -> Void) {
        do {
            try setupLibbox()
            let config = try loadConfig()

            let platform = IIMsgPlatformInterface(provider: self)
            self.platform = platform

            var newError: NSError?
            guard let service = LibboxNewService(config, platform, &newError) else {
                throw newError ?? Self.err("Failed to create sing-box service")
            }
            self.boxService = service

            try service.start()
            log.info("sing-box service started")
            completionHandler(nil)
        } catch {
            log.error("startTunnel failed: \(error.localizedDescription, privacy: .public)")
            completionHandler(error)
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason,
                            completionHandler: @escaping () -> Void) {
        log.info("stopTunnel reason=\(reason.rawValue)")
        if let service = boxService {
            try? service.close()
        }
        boxService = nil
        platform = nil
        completionHandler()
    }

    private func setupLibbox() throws {
        // Niente App Group: uso il container privato dell'estensione (Application Support).
        let base = NSSearchPathForDirectoriesInDomains(.applicationSupportDirectory, .userDomainMask, true).first
            ?? NSTemporaryDirectory()
        let work = (base as NSString).appendingPathComponent("singbox-work")
        let temp = NSTemporaryDirectory()
        try? FileManager.default.createDirectory(atPath: base, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: work, withIntermediateDirectories: true)

        let options = LibboxSetupOptions()
        options.basePath = base
        options.workingPath = work
        options.tempPath = temp
        options.username = ""
        options.isTVOS = false
        options.fixAndroidStack = false

        var setupError: NSError?
        LibboxSetup(options, &setupError)
        if let setupError { throw setupError }
    }

    /// La config sing-box arriva sempre dall'app via providerConfiguration["config"].
    private func loadConfig() throws -> String {
        if let proto = protocolConfiguration as? NETunnelProviderProtocol,
           let cfg = proto.providerConfiguration?["config"] as? String,
           !cfg.isEmpty {
            return cfg
        }
        throw Self.err("No sing-box configuration available")
    }

    static func err(_ msg: String) -> NSError {
        NSError(domain: "com.oleventechnologies.iiprivatemessenger.tunnel", code: 1,
                userInfo: [NSLocalizedDescriptionKey: msg])
    }
}
