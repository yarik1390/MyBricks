# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# --- BricksVault: R8 keep rules for the Capacitor WebView bridge ---
# Capacitor + plugins ship consumer rules; these are defensive duplicates for
# the reflection-heavy surfaces that break silently when stripped.
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
-keepattributes JavascriptInterface, *Annotation*
# RevenueCat models cross the JS bridge as JSON via reflection.
-keep class com.revenuecat.purchases.** { *; }
# RevenueCat Amazon store: its consumer rules are ignored in build.gradle
# because they carry -dontoptimize; these are the rest of that file.
-dontwarn com.amazon.**
-keep class com.amazon.** { *; }

# Credential Manager (GoogleIdSignInPlugin): keep the Play Services provider
# it loads by reflection.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }

# Live barcode scanner (@capacitor-mlkit/barcode-scanning startScan: CameraX
# preview behind the WebView + bundled ML Kit decoder). The in-app live scanner
# started 7-20 times a day until R8 shrinking (2026-10-27) and full R8
# optimisation (2026-10-31) shipped; from then on almost every start rejected
# with an empty or obfuscated error ("lfail:error", "lfail:f0-j1-f0-w-devic")
# and users fell back to ML Kit's own screen. CameraX and ML Kit load parts of
# themselves by reflection, so keep the whole scanner stack unshrunk.
-keep class androidx.camera.** { *; }
-keep interface androidx.camera.** { *; }
-keep class io.capawesome.capacitorjs.plugins.mlkit.barcodescanning.** { *; }
-keep class com.google.mlkit.vision.barcode.** { *; }
-keep class com.google.mlkit.vision.common.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_barcode_bundled.** { *; }
