import Foundation
import CommonCrypto

enum PosnicPinKey {
  enum Failure: Error { case invalidInput, derivation }

  static func derive(pin: String, saltHex: String) throws -> String {
    guard (4...6).contains(pin.utf8.count), pin.utf8.allSatisfy({ (48...57).contains($0) }),
          saltHex.utf8.count == 96,
          saltHex.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
      throw Failure.invalidInput
    }
    var salt = stride(from: 0, to: saltHex.count, by: 2).map { offset -> UInt8 in
      let start = saltHex.index(saltHex.startIndex, offsetBy: offset)
      return UInt8(saltHex[start..<saltHex.index(start, offsetBy: 2)], radix: 16)!
    }
    var password = Array(pin.utf8)
    var key = [UInt8](repeating: 0, count: 32)
    defer {
      password.withUnsafeMutableBytes { _ = $0.initializeMemory(as: UInt8.self, repeating: 0) }
      salt.withUnsafeMutableBytes { _ = $0.initializeMemory(as: UInt8.self, repeating: 0) }
      key.withUnsafeMutableBytes { _ = $0.initializeMemory(as: UInt8.self, repeating: 0) }
    }
    let passwordLength = password.count
    let saltLength = salt.count
    let status = password.withUnsafeBytes { passwordBytes in
      salt.withUnsafeBytes { saltBytes in
        key.withUnsafeMutableBytes { keyBytes in
          CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
            passwordBytes.baseAddress!.assumingMemoryBound(to: Int8.self), passwordLength,
            saltBytes.baseAddress!.assumingMemoryBound(to: UInt8.self), saltLength,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 600_000,
            keyBytes.baseAddress!.assumingMemoryBound(to: UInt8.self), 32)
        }
      }
    }
    guard status == kCCSuccess else { throw Failure.derivation }
    return key.map { String(format: "%02x", $0) }.joined()
  }
}
