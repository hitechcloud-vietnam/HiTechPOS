package com.posnic.captain;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

@CapacitorPlugin(name = "LocalNetwork")
public class LocalNetworkPlugin extends Plugin {
    @PluginMethod
    public void getLocalIp(PluginCall call) {
        try {
            String fallbackIp = null;
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) continue;

                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) continue;
                    String ip = address.getHostAddress();
                    if (!address.isSiteLocalAddress()) continue;

                    if (network.getName().startsWith("wlan")) {
                        JSObject result = new JSObject();
                        result.put("ip", ip);
                        result.put("wifi", true);
                        call.resolve(result);
                        return;
                    }
                    if (fallbackIp == null) fallbackIp = ip;
                }
            }

            JSObject result = new JSObject();
            result.put("ip", fallbackIp == null ? "" : fallbackIp);
            result.put("wifi", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read local network address", error);
        }
    }
}
