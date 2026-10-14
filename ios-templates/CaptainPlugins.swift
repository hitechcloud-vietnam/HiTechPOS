import Foundation
import UIKit
import Security
import CommonCrypto
import Capacitor
import Darwin

// This file is included in the generated App target by install-ios-plugins.js.
final class CaptainBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CaptainSecureSessionPlugin())
        bridge?.registerPluginInstance(CaptainLocalNetworkPlugin())
    }
}

private struct CaptainAccessError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@objc(CaptainSecureSessionPlugin)
public final class CaptainSecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CaptainSecureSessionPlugin"
    public let jsName = "SecureSession"
    public let pluginMethods: [CAPPluginMethod] = [
        "status", "save", "setPin", "unlock", "removePin", "lock", "clear", "openBrowser"
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let queue = DispatchQueue(label: "com.posnic.captain.secure-session")
    private var unlocked = false
    private var inactiveObserver: NSObjectProtocol?
    private var account = ""

    public override func load() {
        // An installation identifier keeps a reinstall from restoring old staff credentials.
        let key = "captain.keychain.installation.v1"
        account = UserDefaults.standard.string(forKey: key) ?? UUID().uuidString
        UserDefaults.standard.set(account, forKey: key)
        inactiveObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification, object: nil, queue: nil
        ) { [weak self] _ in
            guard let self = self else { return }
            self.queue.async { self.unlocked = false }
        }
    }
    deinit {
        if let observer = inactiveObserver { NotificationCenter.default.removeObserver(observer) }
    }
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.posnic.captain.session.v1",
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: false]
    }
    private func read() throws -> [String: Any] {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return [:] }
        guard status == errSecSuccess, let data = result as? Data,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CaptainAccessError(message: "Ask your manager to reconnect this phone. Your orders are saved.")
        }
        return value
    }
    private func write(_ value: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        let changes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(changes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw CaptainAccessError(message: "Ask your manager to reconnect this phone. Your orders are saved.") }
    }
    private func derive(_ pin: String, _ salt: Data) throws -> Data {
        let password = Array(pin.utf8)
        var output = [UInt8](repeating: 0, count: 32)
        let status = password.withUnsafeBytes { passwordBytes in
            salt.withUnsafeBytes { saltBytes in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
                    passwordBytes.baseAddress?.assumingMemoryBound(to: Int8.self), password.count,
                    saltBytes.baseAddress?.assumingMemoryBound(to: UInt8.self), salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 210000, &output, 32)
            }
        }
        guard status == kCCSuccess else { throw CaptainAccessError(message: "Ask your manager to reconnect this phone. Your orders are saved.") }
        return Data(output)
    }
    private func result(_ value: [String: Any]) -> PluginCallResultData {
        let pinSet = value["pin"] != nil
        var out: PluginCallResultData = ["pinSet":pinSet, "locked":pinSet && !unlocked,
                             "attempts":max(0, 5 - (value["failures"] as? Int ?? 0))]
        if let session = value["session"] as? [String: Any] {
            out["profile"] = ["user":session["user"] ?? NSNull(),
                              "shopKey":session["shopKey"] ?? NSNull(), "base":session["base"] ?? NSNull()]
            if unlocked || !pinSet { out["session"] = session }
        }
        return out
    }
    private func perform(_ call: CAPPluginCall, _ action: @escaping () throws -> PluginCallResultData) {
        queue.async {
            do { call.resolve(try action()) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func status(_ call: CAPPluginCall) { perform(call) { self.result(try self.read()) } }
    @objc func save(_ call: CAPPluginCall) {
        perform(call) {
            var value = try self.read()
            guard let session = call.getObject("session") else { throw CaptainAccessError(message:"Ask your manager to reconnect this phone. Your orders are saved.") }
            guard value["pin"] == nil || self.unlocked else { throw CaptainAccessError(message:"Unlock this phone first.") }
            value["session"] = session
            try self.write(value)
            return self.result(value)
        }
    }
    @objc func setPin(_ call: CAPPluginCall) {
        perform(call) {
            var value = try self.read()
            let pin = call.getString("pin") ?? ""
            guard pin.range(of:"^[0-9]{4,6}$",options:.regularExpression) != nil,
                  value["session"] != nil, value["pin"] == nil || self.unlocked else {
                throw CaptainAccessError(message:"Unlock this phone first.")
            }
            var salt = [UInt8](repeating:0,count:32)
            guard SecRandomCopyBytes(kSecRandomDefault,salt.count,&salt) == errSecSuccess else {
                throw CaptainAccessError(message:"Ask your manager to reconnect this phone. Your orders are saved.")
            }
            value["salt"] = Data(salt).base64EncodedString()
            value["pin"] = try self.derive(pin,Data(salt)).base64EncodedString()
            value["failures"] = 0
            try self.write(value)
            self.unlocked = true
            return self.result(value)
        }
    }
    @objc func unlock(_ call: CAPPluginCall) {
        perform(call) {
            var value = try self.read()
            let failures = value["failures"] as? Int ?? 0
            guard let encoded = value["pin"] as? String, let expected = Data(base64Encoded:encoded),
                  let encodedSalt = value["salt"] as? String, let salt = Data(base64Encoded:encodedSalt), failures < 5 else {
                throw CaptainAccessError(message:"Ask your manager to reconnect this phone. Your orders are saved.")
            }
            self.unlocked = false
            value["failures"] = failures + 1
            try self.write(value) // Persist the attempt before evaluating it.
            let actual = try self.derive(call.getString("pin") ?? "",salt)
            var difference = UInt8(actual.count == expected.count ? 0 : 1)
            for (a,b) in zip(actual,expected) { difference |= a ^ b }
            if difference == 0 {
                value["failures"] = 0
                try self.write(value)
                self.unlocked = true
            }
            return self.result(value)
        }
    }
    @objc func removePin(_ call: CAPPluginCall) {
        perform(call) {
            guard self.unlocked else { throw CaptainAccessError(message:"Unlock this phone first.") }
            var value = try self.read()
            value.removeValue(forKey:"pin"); value.removeValue(forKey:"salt"); value.removeValue(forKey:"failures")
            try self.write(value)
            return self.result(value)
        }
    }
    @objc func lock(_ call: CAPPluginCall) { perform(call) { self.unlocked = false; return [:] } }
    @objc func clear(_ call: CAPPluginCall) {
        perform(call) {
            let status = SecItemDelete(self.query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw CaptainAccessError(message:"Ask your manager to reconnect this phone. Your orders are saved.") }
            self.unlocked = false
            return [:] // The order database and identity-bound queue are untouched.
        }
    }
    @objc func openBrowser(_ call: CAPPluginCall) {
        guard let text = call.getString("url"), let url = URL(string:text),
              url.scheme == "https", url.host == "www.posnic.com", url.path == "/api/mobile/authorize",
              url.user == nil, url.password == nil, url.port == nil || url.port == 443 else {
            call.reject("Could not connect. Try again."); return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url,options:[:]) { opened in
                if opened { call.resolve() } else { call.reject("Could not connect. Try again.") }
            }
        }
    }
}

@objc(CaptainLocalNetworkPlugin)
public final class CaptainLocalNetworkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CaptainLocalNetworkPlugin"
    public let jsName = "LocalNetwork"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name:"getLocalIp",returnType:CAPPluginReturnPromise)]
    @objc func getLocalIp(_ call: CAPPluginCall) {
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0 else { call.reject("Connect this phone to the shop Wi-Fi and try again."); return }
        defer { freeifaddrs(interfaces) }
        var cursor = interfaces
        while let current = cursor {
            let interface = current.pointee
            defer { cursor = interface.ifa_next }
            guard let address = interface.ifa_addr,
                  address.pointee.sa_family == UInt8(AF_INET),
                  String(cString:interface.ifa_name) == "en0",
                  (interface.ifa_flags & UInt32(IFF_UP)) != 0 else { continue }
            var host = [CChar](repeating:0,count:Int(NI_MAXHOST))
            if getnameinfo(address,socklen_t(address.pointee.sa_len),&host,socklen_t(host.count),nil,0,NI_NUMERICHOST) == 0 {
                call.resolve(["wifi":true,"ip":String(cString:host)]); return
            }
        }
        call.resolve(["wifi":false,"ip":""])
    }
}
