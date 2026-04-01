// click-tap.swift
//
// Reference implementation of a macOS CGEventTap for global mouse click detection.
//
// This file is provided as a REFERENCE / FALLBACK. The primary click detection
// mechanism in click-detector.js uses `uiohook-napi` which is a cross-platform
// npm package that requires no manual compilation.
//
// Use this Swift implementation if:
//   1. uiohook-napi is not compatible with your Electron version
//   2. You need lower-level access to CGEvent fields (e.g. modifier keys, pressure)
//   3. You want a pure macOS native approach
//
// ─────────────────────────────────────────────────────────────────────────────
// COMPILATION
//
// To compile this as a standalone binary (for testing):
//   swiftc click-tap.swift -o click-tap
//   ./click-tap
//
// To integrate as a Node.js native addon:
//   1. Use `ffi-napi` to call a compiled dylib:
//      swiftc -emit-library click-tap.swift -o click-tap.dylib
//      Then use ffi-napi in Node.js to load click-tap.dylib
//
//   2. Or wrap in a node-addon-api C++ bridge (binding.gyp + addon.cc)
//      that calls into the Swift dylib via a C shim.
//
// macOS Permission required:
//   The app must have Accessibility permission in
//   System Settings → Privacy & Security → Accessibility
//   before CGEventTapCreate will succeed.
// ─────────────────────────────────────────────────────────────────────────────

import Cocoa
import CoreGraphics

// ── C-callable interface (for ffi-napi integration) ──────────────────────────

// Callback type that will be called from Node.js via ffi-napi
typealias ClickCallback = @convention(c) (Int32, Int32, Int32) -> Void

var globalClickCallback: ClickCallback? = nil

@_cdecl("setClickCallback")
public func setClickCallback(_ callback: ClickCallback?) {
    globalClickCallback = callback
}

@_cdecl("startEventTap")
public func startEventTap() -> Bool {
    return EventTapManager.shared.start()
}

@_cdecl("stopEventTap")
public func stopEventTap() {
    EventTapManager.shared.stop()
}

// ── EventTapManager ──────────────────────────────────────────────────────────

class EventTapManager {
    static let shared = EventTapManager()

    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var tapThread: Thread?

    func start() -> Bool {
        // Check Accessibility permission
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        let trusted = AXIsProcessTrustedWithOptions(options)

        if !trusted {
            print("[click-tap] ERROR: Accessibility permission not granted.")
            print("[click-tap] Open System Settings → Privacy & Security → Accessibility")
            print("[click-tap] and enable your app.")
            return false
        }

        // Event mask: left mouse down + right mouse down
        let eventMask: CGEventMask =
            (1 << CGEventType.leftMouseDown.rawValue) |
            (1 << CGEventType.rightMouseDown.rawValue)

        // Create the event tap
        eventTap = CGEvent.tapCreate(
            tap: .cghidEventTap,           // Tap at HID level (before app receives event)
            place: .headInsertEventTap,    // Insert at head of tap list
            options: .defaultTap,          // Passive — don't modify events
            eventsOfInterest: eventMask,
            callback: eventTapCallback,
            userInfo: nil
        )

        guard let tap = eventTap else {
            print("[click-tap] Failed to create CGEventTap. Check Accessibility permission.")
            return false
        }

        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)

        // Run the event tap on a background thread with its own run loop
        tapThread = Thread {
            CFRunLoopAddSource(CFRunLoopGetCurrent(), self.runLoopSource, .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            print("[click-tap] Event tap started, entering run loop")
            CFRunLoopRun()
        }
        tapThread?.name = "ProcessTrackerEventTap"
        tapThread?.start()

        return true
    }

    func stop() {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
        if let source = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
        }
        eventTap = nil
        runLoopSource = nil
        print("[click-tap] Event tap stopped")
    }
}

// ── CGEvent callback ─────────────────────────────────────────────────────────

let eventTapCallback: CGEventTapCallBack = { proxy, type, event, userInfo in
    let location = event.location
    let x = Int32(location.x)
    let y = Int32(location.y)

    // Determine button: 1 = left, 2 = right
    let button: Int32 = (type == .leftMouseDown) ? 1 : 2

    // Call Node.js callback if registered
    if let callback = globalClickCallback {
        callback(x, y, button)
    } else {
        // Standalone mode: print to stdout
        print("[click-tap] Click at (\(x), \(y)) button=\(button)")
    }

    // Return the event unmodified (passive tap)
    return Unmanaged.passRetained(event)
}

// ── Standalone test entrypoint ────────────────────────────────────────────────

// Only runs when compiled as a standalone binary (not when used as a library)
#if !LIBRARY_BUILD
print("[click-tap] Starting standalone test mode")
print("[click-tap] Click anywhere on screen to see coordinates. Ctrl+C to exit.")

let success = EventTapManager.shared.start()
if success {
    // Keep running
    RunLoop.main.run()
} else {
    exit(1)
}
#endif
