package com.posnic.printer

import android.bluetooth.BluetoothManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Bluetooth Classic SPP, ESC/POS raster profile. Transport submission is not paper confirmation. */
class PosnicPrinterModule : Module() {
  private val running = AtomicBoolean(false)
  private fun adapter() = (appContext.reactContext?.getSystemService(BluetoothManager::class.java)
    ?: error("deviceUnavailable")).adapter ?: error("deviceUnavailable")

  override fun definition() = ModuleDefinition {
    Name("PosnicPrinter")
    AsyncFunction("derivePinKey") { pin: String, saltHex: String, promise: Promise ->
      // Dedicated worker: PIN setup neither blocks Hermes nor printer I/O.
      val worker = Executors.newSingleThreadExecutor()
      worker.execute {
        try {
          require(Regex("[0-9]{4,6}").matches(pin))
          require(Regex("[a-f0-9]{96}").matches(saltHex))
          val salt = saltHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
          val spec = javax.crypto.spec.PBEKeySpec(pin.toCharArray(), salt, 600000, 256)
          try {
            val key = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            try { promise.resolve(key.joinToString("") { "%02x".format(it.toInt() and 255) }) }
            finally { key.fill(0) }
          } finally { spec.clearPassword(); salt.fill(0) }
        } catch (error: Exception) { promise.reject("PIN_DERIVATION_FAILED", "PIN setup could not complete. Try again.", null) }
        finally { worker.shutdown() }
      }
    }
    AsyncFunction("pairedDevices") {
      val bluetooth = adapter()
      if (!bluetooth.isEnabled) error("deviceUnavailable")
      bluetooth.bondedDevices.map { mapOf("address" to it.address, "name" to (it.name ?: it.address)) }
    }
    AsyncFunction("usbDevices") { UsbPrinter(appContext.reactContext ?: error("deviceUnavailable")).devices() }
    AsyncFunction("requestUsbPermission") { address:String, promise:Promise ->
      UsbPrinter(appContext.reactContext ?: error("deviceUnavailable")).request(address,promise)
    }
    AsyncFunction("printReceipt") { address: String, text: String, width: Int, drawerPin: Int ->
      if (!running.compareAndSet(false, true)) error("printCheckPaper")
      var sent = false
      var socket: android.bluetooth.BluetoothSocket? = null
      var usbStream: java.io.OutputStream? = null
      val timer = Executors.newSingleThreadScheduledExecutor()
      try {
        require(width == 384 || width == 576)
        require(drawerPin in -1..1)
        require(text.length in 1..24000)
        val connect: () -> java.io.OutputStream
        if(address.startsWith("usb:")) {
          usbStream=UsbPrinter(appContext.reactContext ?: error("deviceUnavailable")).open(address)
          connect={usbStream ?: error("deviceUnavailable")}
        } else {
          val bluetooth = adapter()
          if (!bluetooth.isEnabled) error("deviceUnavailable")
          val device = bluetooth.bondedDevices.firstOrNull { it.address == address } ?: error("deviceUnavailable")
          socket=device.createRfcommSocketToServiceRecord(UUID.fromString("00001101-0000-1000-8000-00805f9b34fb"))
          val target=socket!!
          connect={target.connect();target.outputStream}
        }
        timer.schedule({try {socket?.close();usbStream?.close()} catch (_:Exception) {}},45,TimeUnit.SECONDS)
        val paint = TextPaint().apply { color = Color.BLACK; textSize = 24f; isAntiAlias = true }
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, width - 24)
          .setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(true).build()
        require(layout.height <= 24000)
        val bitmap = Bitmap.createBitmap(width, layout.height + 24, Bitmap.Config.ARGB_8888)
        try {
          Canvas(bitmap).apply { drawColor(Color.WHITE); translate(12f, 12f); layout.draw(this) }
          val output = connect()
          // Mark uncertain before the first write: write() can fail after partial delivery.
          sent = true
          output.write(byteArrayOf(0x1b, 0x40))
          val bytesWide = width / 8
          var top = 0
          while (top < bitmap.height) {
            val height = minOf(128, bitmap.height - top)
            val data = ByteArray(8 + bytesWide * height)
            data[0] = 0x1d; data[1] = 0x76; data[2] = 0x30; data[3] = 0
            data[4] = (bytesWide and 255).toByte(); data[5] = (bytesWide shr 8).toByte()
            data[6] = (height and 255).toByte(); data[7] = (height shr 8).toByte()
            for (y in 0 until height) for (x in 0 until width) {
              val pixel = bitmap.getPixel(x, top + y)
              if ((Color.red(pixel) * 299 + Color.green(pixel) * 587 + Color.blue(pixel) * 114) < 128000) {
                val index = 8 + y * bytesWide + x / 8
                data[index] = (data[index].toInt() or (0x80 shr (x % 8))).toByte()
              }
            }
            output.write(data)
            output.flush()
            top += height
          }
          output.write(byteArrayOf(0x0a, 0x0a, 0x0a))
          // ESC p: 100 ms on, 400 ms off. Never included in tests or reprints.
          if (drawerPin >= 0) output.write(byteArrayOf(0x1b, 0x70, drawerPin.toByte(), 50, 200.toByte()))
          output.flush()
          mapOf("state" to "submitted", "submitted" to true)
        } finally { bitmap.recycle() }
      } catch (_: Exception) {
        mapOf("state" to if (sent) "unknown" else "failed", "submitted" to sent)
      } finally {
        try { socket?.close(); usbStream?.close() } catch (_: Exception) {}
        timer.shutdownNow()
        running.set(false)
      }
    }
  }
}
