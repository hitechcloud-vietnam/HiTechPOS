import Foundation

@main
struct PinKeyTest {
  static func main() throws {
    let salt = String(repeating: "07", count: 48)
    let start = Date()
    let key = try PosnicPinKey.derive(pin: "4829", saltHex: salt)
    precondition(key == "df5c215abb7b9bf7ab7f72a6cef564dbaa7f423543e54ae8f3646ce3ea6c2e41")
    let different = try PosnicPinKey.derive(pin: "9871", saltHex: salt)
    precondition(key != different)
    for (pin, invalidSalt) in [("4829\n", salt), ("4829", "gg" + salt.dropFirst(2)), ("4829", "07"), ("", salt)] {
      do {
        _ = try PosnicPinKey.derive(pin: pin, saltHex: String(invalidSalt))
        fatalError("Invalid input accepted")
      } catch PosnicPinKey.Failure.invalidInput {}
    }
    print("Native PIN vector and input checks passed in \(Date().timeIntervalSince(start)) seconds")
  }
}
