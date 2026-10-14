package com.posnic.printer

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.*
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** USB printer class only. Never claim a scanner, storage device or payment reader. */
class UsbPrinter(private val context: Context) {
  private val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
  private fun port(device: UsbDevice): Pair<UsbInterface,UsbEndpoint>? {
    for (i in 0 until device.interfaceCount) {
      val face=device.getInterface(i)
      if(face.interfaceClass != UsbConstants.USB_CLASS_PRINTER) continue
      for(e in 0 until face.endpointCount) {
        val endpoint=face.getEndpoint(e)
        if(endpoint.type==UsbConstants.USB_ENDPOINT_XFER_BULK && endpoint.direction==UsbConstants.USB_DIR_OUT)
          return Pair(face,endpoint)
      }
    }
    return null
  }
  private fun address(device:UsbDevice):String {
    val serial=if(manager.hasPermission(device)) try {device.serialNumber} catch (_:Exception) {null} else null
    val identity=if(!serial.isNullOrBlank()) "serial:"+android.util.Base64.encodeToString(serial.toByteArray(),android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP) else "attached:"+device.deviceName
    return "usb:"+device.vendorId+":"+device.productId+":"+identity
  }
  private fun device(address:String):UsbDevice = manager.deviceList.values.firstOrNull {
    address(it)==address && port(it)!=null
  } ?: error("deviceUnavailable")
  fun devices() = manager.deviceList.values.filter {port(it)!=null}.map {
    mapOf("address" to address(it),
      "name" to ((try {it.productName} catch (_:Exception) {null}) ?: "USB printer")+" · "+it.vendorId.toString(16)+":"+it.productId.toString(16))
  }
  fun request(address:String,promise:Promise) {
    val device=try {device(address)} catch(e:Exception) {promise.reject("deviceUnavailable","USB printer disconnected",e);return}
    if(manager.hasPermission(device)) {promise.resolve(address(device));return}
    val action=context.packageName+".USB_PRINTER_PERMISSION."+UUID.randomUUID()
    val finished=AtomicBoolean(false)
    val handler=Handler(Looper.getMainLooper())
    lateinit var receiver:BroadcastReceiver
    lateinit var timeout:Runnable
    fun finish(granted:Boolean) {
      if(!finished.compareAndSet(false,true))return
      handler.removeCallbacks(timeout)
      try {context.unregisterReceiver(receiver)} catch (_:Exception) {}
      promise.resolve(if(granted) address(device) else null)
    }
    receiver=object:BroadcastReceiver() {
      override fun onReceive(ctx:Context,intent:Intent) {
        if(intent.action==action) finish(manager.hasPermission(device))
      }
    }
    timeout=Runnable {finish(false)}
    try {
      if(Build.VERSION.SDK_INT>=33) context.registerReceiver(receiver,IntentFilter(action),Context.RECEIVER_NOT_EXPORTED)
      else { @Suppress("DEPRECATION") context.registerReceiver(receiver,IntentFilter(action)) }
      handler.postDelayed(timeout,30000)
      manager.requestPermission(device,PendingIntent.getBroadcast(context,0,Intent(action).setPackage(context.packageName),PendingIntent.FLAG_IMMUTABLE))
    } catch (_:Exception) {finish(false)}
  }
  fun open(address:String):OutputStream {
    val device=device(address)
    if(!manager.hasPermission(device))error("permissionDenied")
    val (face,endpoint)=port(device) ?: error("deviceUnavailable")
    val connection=manager.openDevice(device) ?: error("deviceUnavailable")
    if(!connection.claimInterface(face,false)){connection.close();error("deviceUnavailable")}
    return object:OutputStream() {
      private val closed=AtomicBoolean(false)
      override fun write(value:Int) {write(byteArrayOf(value.toByte()))}
      override fun write(bytes:ByteArray,offset:Int,length:Int) {
        var sent=0
        while(sent<length) {
          if(closed.get())error("deviceUnavailable")
          val result=connection.bulkTransfer(endpoint,bytes,offset+sent,minOf(16384,length-sent),5000)
          if(result<=0)error("deviceUnavailable")
          sent+=result
        }
      }
      override fun close() {
        if(closed.compareAndSet(false,true))try {connection.releaseInterface(face)} finally {connection.close()}
      }
    }
  }
}
