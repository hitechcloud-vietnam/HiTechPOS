import ExpoModulesCore
import Vision
import UIKit

public final class PosnicRecognitionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PosnicRecognition")
    AsyncFunction("readText") { (base64: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          guard base64.count <= 7_000_000, let bytes = Data(base64Encoded: base64),
                let image = UIImage(data: bytes)?.cgImage else {
            promise.reject("PHOTO_INVALID", "photoInvalid"); return
          }
          let request = VNRecognizeTextRequest()
          request.recognitionLevel = .accurate
          request.usesLanguageCorrection = false
          request.automaticallyDetectsLanguage = true
          try VNImageRequestHandler(cgImage: image).perform([request])
          promise.resolve((request.results ?? []).compactMap { $0.topCandidates(1).first?.string })
        } catch { promise.reject("PHOTO_READ_FAILED", "photoReadFailed") }
      }
    }
  }
}
