package com.posnic.recognition

import android.graphics.BitmapFactory
import android.util.Base64
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PosnicRecognitionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PosnicRecognition")
    AsyncFunction("readText") { base64: String, promise: Promise ->
      try {
        require(base64.length <= 7000000)
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: error("photoInvalid")
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
          .addOnSuccessListener { result ->
            promise.resolve(result.textBlocks.flatMap { it.lines }.map { it.text })
          }
          .addOnFailureListener { promise.reject("PHOTO_READ_FAILED", "photoReadFailed", it) }
          .addOnCompleteListener { recognizer.close(); bitmap.recycle() }
      } catch (e: Exception) { promise.reject("PHOTO_INVALID", "photoInvalid", e) }
    }
  }
}
