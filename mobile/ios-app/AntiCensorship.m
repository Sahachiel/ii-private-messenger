//
//  AntiCensorship.m — bridge RN per il transport anti-censura iOS (VLESS+REALITY).
//
//  Espone alla parte JS (mobile/src/services/transport.ts) lo stesso contratto del
//  modulo Android `AntiCensorship`:
//    - prepare()            -> richiede il consenso VPN di sistema (una tantum)
//    - start({server,port,uuid,pbk,sid,sni,flow,fp}) -> avvia il tunnel
//    - stop()               -> ferma il tunnel
//    - evento DeviceEmitter 'AntiCensorship:state' con { state: idle|connecting|connected|error }
//
//  Su iOS un NEPacketTunnelProvider è un VPN di SISTEMA (tutto il traffico mentre attivo):
//  iOS non offre il per-app senza MDM. La config sing-box è costruita dal proxy_config
//  del backend e passata all'estensione via providerConfiguration["config"].
//
#import <React/RCTBridgeModule.h>
#import <React/RCTBridge.h>
#import <React/RCTEventDispatcher.h>
#import <NetworkExtension/NetworkExtension.h>

static NSString *const kTunnelBundleId = @"com.oleventechnologies.iiprivatemessenger.tunnel";
static NSString *const kStateEvent = @"AntiCensorship:state";

@interface AntiCensorship : NSObject <RCTBridgeModule>
@end

@implementation AntiCensorship {
  NETunnelProviderManager *_manager;
  id _statusObserver;
}

@synthesize bridge = _bridge;

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

#pragma mark - Eventi di stato

- (void)sendState:(NSString *)state {
  [self.bridge.eventDispatcher sendDeviceEventWithName:kStateEvent body:@{ @"state": state }];
}

- (void)emitForStatus:(NEVPNStatus)status {
  NSString *s;
  switch (status) {
    case NEVPNStatusConnecting:
    case NEVPNStatusReasserting:
      s = @"connecting"; break;
    case NEVPNStatusConnected:
      s = @"connected"; break;
    case NEVPNStatusDisconnecting:
    case NEVPNStatusDisconnected:
    case NEVPNStatusInvalid:
    default:
      s = @"idle"; break;
  }
  [self sendState:s];
}

- (void)observeManager:(NETunnelProviderManager *)mgr {
  if (_statusObserver) {
    [[NSNotificationCenter defaultCenter] removeObserver:_statusObserver];
    _statusObserver = nil;
  }
  __weak typeof(self) weakSelf = self;
  _statusObserver = [[NSNotificationCenter defaultCenter]
                     addObserverForName:NEVPNStatusDidChangeNotification
                     object:mgr.connection
                     queue:[NSOperationQueue mainQueue]
                     usingBlock:^(NSNotification * _Nonnull note) {
    [weakSelf emitForStatus:mgr.connection.status];
  }];
}

#pragma mark - Config sing-box dal proxy_config

- (NSString *)singboxConfigFromCfg:(NSDictionary *)cfg {
  NSString *server = [cfg[@"server"] isKindOfClass:NSString.class] ? cfg[@"server"] : @"";
  int port = [cfg[@"port"] respondsToSelector:@selector(intValue)] ? [cfg[@"port"] intValue] : 443;
  NSString *uuid = [cfg[@"uuid"] isKindOfClass:NSString.class] ? cfg[@"uuid"] : @"";
  NSString *pbk  = [cfg[@"pbk"] isKindOfClass:NSString.class] ? cfg[@"pbk"] : @"";
  NSString *sid  = [cfg[@"sid"] isKindOfClass:NSString.class] ? cfg[@"sid"] : @"";
  NSString *sni  = [cfg[@"sni"] isKindOfClass:NSString.class] ? cfg[@"sni"] : @"www.apple.com";
  NSString *flow = [cfg[@"flow"] isKindOfClass:NSString.class] ? cfg[@"flow"] : @"";
  NSString *fp   = [cfg[@"fp"] isKindOfClass:NSString.class] && [cfg[@"fp"] length] ? cfg[@"fp"] : @"chrome";

  NSMutableDictionary *vless = [@{
    @"type": @"vless", @"tag": @"proxy",
    @"server": server,
    @"server_port": @(port),
    @"uuid": uuid,
    @"packet_encoding": @"xudp",
    @"tls": @{
      @"enabled": @YES,
      @"server_name": sni,
      @"utls": @{ @"enabled": @YES, @"fingerprint": fp },
      @"reality": @{ @"enabled": @YES, @"public_key": pbk, @"short_id": sid }
    }
  } mutableCopy];
  if (flow.length > 0) { vless[@"flow"] = flow; }

  NSDictionary *config = @{
    @"log": @{ @"level": @"warn", @"timestamp": @YES },
    @"dns": @{
      @"servers": @[
        @{ @"tag": @"remote", @"address": @"https://1.1.1.1/dns-query", @"detour": @"proxy" },
        @{ @"tag": @"local",  @"address": @"8.8.8.8", @"detour": @"direct" }
      ],
      @"rules": @[ @{ @"outbound": @"any", @"server": @"local" } ],
      @"final": @"remote",
      @"strategy": @"prefer_ipv4"
    },
    @"inbounds": @[ @{
      @"type": @"tun", @"tag": @"tun-in", @"interface_name": @"utun",
      @"inet4_address": @"172.19.0.1/30",
      @"inet6_address": @"fdfe:dcba:9876::1/126",
      @"mtu": @4064, @"auto_route": @YES, @"strict_route": @NO,
      @"stack": @"gvisor", @"sniff": @YES, @"sniff_override_destination": @NO
    } ],
    @"outbounds": @[ vless, @{ @"type": @"direct", @"tag": @"direct" }, @{ @"type": @"dns", @"tag": @"dns-out" } ],
    @"route": @{
      @"rules": @[ @{ @"protocol": @"dns", @"outbound": @"dns-out" }, @{ @"ip_is_private": @YES, @"outbound": @"direct" } ],
      @"final": @"proxy",
      @"auto_detect_interface": @YES
    }
  };

  NSData *data = [NSJSONSerialization dataWithJSONObject:config options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"";
}

#pragma mark - Install / save del profilo

- (void)installWithConfig:(NSString *)configJSON
               completion:(void (^)(NETunnelProviderManager * _Nullable mgr, NSError * _Nullable err))completion {
  [NETunnelProviderManager loadAllFromPreferencesWithCompletionHandler:^(NSArray<NETunnelProviderManager *> *managers, NSError *error) {
    if (error) { completion(nil, error); return; }
    NETunnelProviderManager *mgr = managers.firstObject ?: [[NETunnelProviderManager alloc] init];
    NETunnelProviderProtocol *proto = [[NETunnelProviderProtocol alloc] init];
    proto.providerBundleIdentifier = kTunnelBundleId;
    proto.serverAddress = @"II Private Messenger";
    proto.providerConfiguration = configJSON.length ? @{ @"config": configJSON } : @{ @"config": @"" };
    proto.disconnectOnSleep = NO;
    mgr.protocolConfiguration = proto;
    mgr.localizedDescription = @"II Private Messenger";
    mgr.enabled = YES;
    [mgr saveToPreferencesWithCompletionHandler:^(NSError *saveErr) {
      if (saveErr) { completion(nil, saveErr); return; }
      [mgr loadFromPreferencesWithCompletionHandler:^(NSError *loadErr) {
        if (loadErr) { completion(nil, loadErr); return; }
        completion(mgr, nil);
      }];
    }];
  }];
}

#pragma mark - API esposte a JS

// Richiede il consenso VPN (al primo salvataggio iOS mostra il prompt di sistema).
RCT_EXPORT_METHOD(prepare:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self installWithConfig:nil completion:^(NETunnelProviderManager *mgr, NSError *err) {
    if (err || !mgr) {
      resolve(@(NO));
      return;
    }
    self->_manager = mgr;
    [self observeManager:mgr];
    resolve(@(YES));
  }];
}

// Costruisce la config dal proxy_config, salva il profilo e avvia il tunnel.
RCT_EXPORT_METHOD(start:(NSDictionary *)cfg
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *json = [self singboxConfigFromCfg:cfg];
  if (json.length == 0) { reject(@"config", @"sing-box config build failed", nil); return; }
  [self sendState:@"connecting"];
  [self installWithConfig:json completion:^(NETunnelProviderManager *mgr, NSError *err) {
    if (err || !mgr) {
      [self sendState:@"error"];
      reject(@"install", err.localizedDescription ?: @"install failed", err);
      return;
    }
    self->_manager = mgr;
    [self observeManager:mgr];
    NSError *startErr = nil;
    [mgr.connection startVPNTunnelAndReturnError:&startErr];
    if (startErr) {
      [self sendState:@"error"];
      reject(@"start", startErr.localizedDescription, startErr);
      return;
    }
    resolve(@(YES));
  }];
}

RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (_manager) {
    [_manager.connection stopVPNTunnel];
  }
  [self sendState:@"idle"];
  resolve(@(YES));
}

- (void)dealloc {
  if (_statusObserver) {
    [[NSNotificationCenter defaultCenter] removeObserver:_statusObserver];
  }
}

@end
