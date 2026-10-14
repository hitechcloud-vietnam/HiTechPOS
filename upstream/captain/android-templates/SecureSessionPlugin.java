package com.posnic.captain;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import org.json.JSONObject;

/** Secrets and PIN attempt counters live in a Keystore-encrypted, non-backed-up file. */
@CapacitorPlugin(name = "SecureSession")
public class SecureSessionPlugin extends Plugin {
    private boolean unlocked = false;
    private static final String ALIAS = "posnic.captain.session.v1";
    private SharedPreferences prefs() { return getContext().getSharedPreferences("captain-secure-session", Context.MODE_PRIVATE); }
    private javax.crypto.SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (javax.crypto.SecretKey) ks.getKey(ALIAS, null);
    }
    private byte[] decode(String v) { return Base64.decode(v, Base64.NO_WRAP); }
    private String encode(byte[] v) { return Base64.encodeToString(v, Base64.NO_WRAP); }
    private JSONObject read() throws Exception {
        String value = prefs().getString("vault", null);
        if (value == null) return new JSONObject();
        JSONObject sealed = new JSONObject(value);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, decode(sealed.getString("iv"))));
        return new JSONObject(new String(cipher.doFinal(decode(sealed.getString("data"))), StandardCharsets.UTF_8));
    }
    private void write(JSONObject value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        JSONObject sealed = new JSONObject().put("iv", encode(cipher.getIV())).put("data", encode(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8))));
        if (!prefs().edit().putString("vault", sealed.toString()).commit()) throw new Exception("Secure storage unavailable");
    }
    private byte[] derive(String pin, byte[] salt) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), salt, 210000, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); } finally { spec.clearPassword(); }
    }
    private JSObject result(JSONObject value) throws Exception {
        JSONObject session = value.optJSONObject("session");
        JSObject out = new JSObject();
        out.put("pinSet", value.has("pin")); out.put("locked", value.has("pin") && !unlocked);
        out.put("attempts", Math.max(0, 5 - value.optInt("failures")));
        if (session != null) {
            out.put("profile", new JSONObject().put("user", session.opt("user")).put("shopKey", session.opt("shopKey")).put("base", session.opt("base")));
            if (unlocked || !value.has("pin")) out.put("session", session);
        }
        return out;
    }
    @PluginMethod public synchronized void status(PluginCall call) { try { call.resolve(result(read())); } catch (Exception e) { call.reject("Secure storage unavailable. Ask your manager to recover access."); } }
    @PluginMethod public synchronized void save(PluginCall call) {
        try {
            JSONObject value = read(), session = call.getObject("session");
            if (session == null) throw new Exception("Session missing");
            if (value.has("pin") && !unlocked) throw new Exception("Unlock this phone first");
            value.put("session", session); write(value); call.resolve(result(value));
        } catch (Exception e) { call.reject(e.getMessage()); }
    }
    @PluginMethod public synchronized void setPin(PluginCall call) {
        try {
            JSONObject value = read(); String pin = call.getString("pin", "");
            if (!pin.matches("[0-9]{4,6}") || !value.has("session") || (value.has("pin") && !unlocked)) throw new Exception("Unlock with your current PIN first");
            byte[] salt = new byte[32]; new SecureRandom().nextBytes(salt);
            value.put("salt", encode(salt)).put("pin", encode(derive(pin, salt))).put("failures", 0); write(value); unlocked = true; call.resolve(result(value));
        } catch (Exception e) { call.reject(e.getMessage()); }
    }
    @PluginMethod public synchronized void unlock(PluginCall call) {
        try {
            JSONObject value = read();
            if (!value.has("pin") || value.optInt("failures") >= 5) throw new Exception("Ask your manager to reconnect this phone. Orders are retained.");
            value.put("failures", value.optInt("failures") + 1); write(value);
            if (!MessageDigest.isEqual(derive(call.getString("pin", ""), decode(value.getString("salt"))), decode(value.getString("pin")))) { call.resolve(result(value)); return; }
            value.put("failures", 0); write(value); unlocked = true; call.resolve(result(value));
        } catch (Exception e) { call.reject(e.getMessage()); }
    }
    @PluginMethod public synchronized void removePin(PluginCall call) {
        try { JSONObject value = read(); if (!unlocked) throw new Exception("Unlock first"); value.remove("pin"); value.remove("salt"); value.remove("failures"); write(value); call.resolve(result(value)); } catch (Exception e) { call.reject(e.getMessage()); }
    }
    @PluginMethod public synchronized void lock(PluginCall call) { unlocked = false; call.resolve(); }
    @PluginMethod public void openBrowser(PluginCall call) {
        try {
            android.net.Uri uri = android.net.Uri.parse(call.getString("url", ""));
            if (!"https".equals(uri.getScheme()) || !"www.posnic.com".equals(uri.getHost()) || !"/api/mobile/authorize".equals(uri.getPath())) throw new Exception("Invalid account address");
            getActivity().runOnUiThread(() -> {
                try {
                    android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW, uri);
                    intent.addCategory(android.content.Intent.CATEGORY_BROWSABLE);
                    getActivity().startActivity(intent);
                    call.resolve();
                } catch (Exception e) { call.reject(e.getMessage()); }
            });
        } catch (Exception e) { call.reject(e.getMessage()); }
    }
    @PluginMethod public synchronized void clear(PluginCall call) {
        // Clears credentials only. The order database and identity-bound queue are untouched.
        if (!prefs().edit().remove("vault").commit()) { call.reject("Secure storage unavailable"); return; }
        unlocked = false; call.resolve();
    }
    @Override protected void handleOnPause() { unlocked = false; super.handleOnPause(); }
}
