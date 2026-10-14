import ExpoModulesCore

public final class PosnicSecurityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PosnicSecurity")
    AsyncFunction("derivePinKey") { (pin: String, saltHex: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          promise.resolve(try PosnicPinKey.derive(pin: pin, saltHex: saltHex))
        } catch {
          promise.reject("PIN_DERIVATION_FAILED", "PIN setup could not complete")
        }
      }
    }
  }
}
