import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { WebView } from "react-native-webview";

const BRICKVAULT_URL = "https://brickvault-5ub.pages.dev";

export default function App() {
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const webViewRef = useRef(null);

  const handleExternalNavigation = useCallback((event) => {
    const url = event.url || "";
    if (url.startsWith(BRICKVAULT_URL) || url.startsWith("about:blank")) {
      return true;
    }
    Linking.openURL(url).catch(() => {});
    return false;
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F1E8" />
      {loadError ? (
        <View style={styles.fallback}>
          <Text style={styles.title}>BricksVault could not load</Text>
          <Text style={styles.message}>{loadError}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.button}
            onPress={() => {
              setLoadError(null);
              webViewRef.current?.reload();
            }}
          >
            <Text style={styles.buttonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <WebView
        ref={webViewRef}
        source={{ uri: BRICKVAULT_URL }}
        style={loadError ? styles.hiddenWebView : styles.webView}
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        originWhitelist={["https://*", "mailto:*"]}
        pullToRefreshEnabled
        startInLoadingState
        onNavigationStateChange={(navState) => setCanGoBack(navState.canGoBack)}
        onShouldStartLoadWithRequest={handleExternalNavigation}
        onError={(event) => setLoadError(event.nativeEvent.description || "Network error")}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 500) {
            setLoadError(`Server error ${event.nativeEvent.statusCode}`);
          }
        }}
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color="#E5D117" size="large" />
          </View>
        )}
      />
      {canGoBack && !loadError ? (
        <TouchableOpacity
          accessibilityLabel="Go back"
          accessibilityRole="button"
          style={styles.backButton}
          onPress={() => webViewRef.current?.goBack()}
        >
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F1E8"
  },
  webView: {
    flex: 1,
    backgroundColor: "#F5F1E8"
  },
  hiddenWebView: {
    width: 0,
    height: 0,
    opacity: 0
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F5F1E8"
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
    backgroundColor: "#F5F1E8"
  },
  title: {
    color: "#102A43",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center"
  },
  message: {
    color: "#52616F",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center"
  },
  button: {
    minHeight: 48,
    minWidth: 150,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#E5D117",
    paddingHorizontal: 20
  },
  buttonText: {
    color: "#102A43",
    fontSize: 15,
    fontWeight: "800"
  },
  backButton: {
    position: "absolute",
    left: 16,
    top: 60,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "rgba(16, 42, 67, 0.88)",
    paddingHorizontal: 16
  },
  backButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800"
  }
});
