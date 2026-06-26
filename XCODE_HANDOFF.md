# RastaTune Xcode Handoff

This repo is a static web app. Keep the iOS app as a thin native shell around these files unless the tuner itself needs to be rewritten later.

## Files To Bundle

Add these files to the Xcode app target as bundled resources:

- `index.html`
- `style.css`
- `script.js`
- `privacy.html`
- `assets/`

No build step is required.

## Native iOS Requirements

Add an `NSMicrophoneUsageDescription` purpose string to the app `Info.plist`.

Suggested copy:

> RastaTune uses the microphone to listen to your guitar and calculate pitch. Audio is processed on your device and is not recorded or uploaded.

Use `WKWebView` to load the bundled `index.html`. The page calls `navigator.mediaDevices.getUserMedia`, so the native wrapper must allow WebKit media capture:

- Set the web view `uiDelegate`.
- Handle `webView(_:requestMediaCapturePermissionFor:initiatedByFrame:type:decisionHandler:)`.
- Allow microphone capture for the bundled app origin.
- Do not request camera permission; the tuner only needs microphone audio.

Apple references:

- `NSMicrophoneUsageDescription`: https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSMicrophoneUsageDescription
- `WKUIDelegate` media capture permission: https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:requestmediacapturepermissionfor:initiatedbyframe:type:decisionhandler:)

## Layout QA

The current layout was checked in Chrome mobile emulation at these iPhone viewport sizes:

- 375 x 667, iPhone SE 2 style
- 360 x 780, iPhone 12 mini style
- 393 x 852, iPhone 14 Pro style
- 430 x 932, iPhone 14 Pro Max style

Results:

- No horizontal overflow was detected.
- No regular viewport clipped the core tuner controls.
- The mobile view automatically scales the full tuner to the largest size that keeps the logo, character, string controls, meter, demo slider, and status line visible in the phone viewport.
- Native safe-area padding was simulated for notched iPhones. When the usable height gets tighter, the app scales down instead of requiring pinch zoom.

Before App Store submission, run on a physical iPhone and verify:

- the system microphone prompt appears with the purpose string above;
- tapping `Mic` starts live pitch detection after permission is granted;
- the logo, buttons, tuner meter, string buttons, and demo slider do not collide with the status bar, Dynamic Island, or home indicator;
- the privacy policy URL is reachable from the final app listing/support materials.
