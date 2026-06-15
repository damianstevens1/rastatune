# RastaTune

RastaTune is a static mobile-first guitar tuner prototype with browser microphone pitch detection, automatic six-string targeting, and animated flame feedback.

## What It Does

- Requests microphone access on launch for live tuning.
- Detects the closest standard guitar string:
  - Low E: 82.41 Hz
  - A: 110.00 Hz
  - D: 146.83 Hz
  - G: 196.00 Hz
  - B: 246.94 Hz
  - High E: 329.63 Hz
- Shows frequency, cents off target, and tune direction.
- Includes a no-mic demo slider for preview/testing.
- Uses only static files: `index.html`, `style.css`, `script.js`, and `assets/`.

## Running Locally

Open `index.html` directly, or serve the folder with any static web server.

For microphone access, use HTTPS in production. Browsers require the user to grant microphone permission before live tuning can start.

## Deploying

This repo is Netlify-ready as a static site. No build command is required. Publish the repository root.

## App Store Direction

This is currently a static web app. To ship through the Apple App Store, wrap it in a native iOS shell using Xcode/WKWebView or a wrapper such as Capacitor, then handle App Store microphone permission copy in the native project.

