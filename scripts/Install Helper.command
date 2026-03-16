#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="SolQuoter.app"
APP_PATH="$SCRIPT_DIR/$APP_NAME"

if [ ! -d "$APP_PATH" ]; then
  osascript -e 'display dialog "Could not find SolQuoter.app in this folder. Make sure you opened the .dmg file." buttons {"OK"} default button "OK" with icon stop'
  exit 1
fi

xattr -rd com.apple.quarantine "$APP_PATH" 2>/dev/null || true
cp -R "$APP_PATH" "/Applications/$APP_NAME"

osascript -e 'display dialog "SolQuoter installed successfully. You can now launch it from your Applications folder." buttons {"OK"} default button "OK"'
