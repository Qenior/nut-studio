# NUT Studio v1.1.5 device adapter

## Dedicated strip shortcut (v1.1.5)

NUT_STRIP_TOGGLE is an explicitly assigned software action, encoded as standard
F24 (0x0073), not a fabricated firmware opcode. Register only VK_F24 (0x87)
with MOD_NOREPEAT after the user applies this action through Windows HID.
Keep RGB_TOG=0x7820 and CUSTOM(16)=0x7e10 unchanged; never relabel RL_OFF as
a native bidirectional toggle. The native handler only sends an event counter;
all HID changes go through the existing UI live transaction queue. Long polling
avoids timer-based polling latency in a minimized window. An owner ID prevents
old windows from consuming the same notifications, and an idle lease releases
registration when no client remains. Closing/disconnecting suspends registration.

Toggle jobs form ordering barriers between coalesced parameter batches. Inside
one serialized transaction, read actual channel 3 lighting and channel 0 mode.
To turn off, remember the effect/mode and set effect 22 plus SYNC. To restore,
set the remembered supported effect/mode; do not zero brightness or color.
Initial already-off without a remembered setting falls back to Solid Color.
Restore preferences are validated and stored beside the application. Snapshots
record the previously committed software-key role separately from raw F24 data,
so recovery can restore the role without rewriting its actual device keycode.

F24 reservation is checked before key writes; on failed key writes, restore
the previous preference/registration. A standalone browser, WebHID connection,
wireless connection or fully closed app cannot execute this software action.
The program installs no general keyboard hook and does not flash firmware.

CU preview functions are independently implemented illustrations, with original
English labels and numeric IDs checked against the provided VIA definition.
The upstream README swaps 12/13 relative to that JSON; retain the JSON mapping
and document the uncertainty instead of changing hardware values speculatively.
Game Mode is only named as KC_GME in custom slot 15; its behavior is not specified
in the public reference, and no performance or Win-lock behavior is asserted.

## CU physical off state (v1.1.3)

The user's v1.1.2 hardware log at 2026-10-22 21:36:57 contains
`RX config=08-03-02-16-00-00-00-00` after the physical off shortcut.
The effect byte 0x16 is decimal 22. It is absent from the published CU VIA menu,
but rejecting this observed device state prevented all subsequent live batches.
The latched live error also prevented the key-apply flush from completing.

Keep the selectable menu unchanged. Accept CU 22 separately for reads,
validation, snapshots, profile restoration, rollback and native writes. Keep
the raw 22 in recovery data; do not silently convert it to 0 on the wire.
Show it as physical off and render a dark SYNC preview. An explicit selection
of a normal effect compares against fresh hardware state and restores lighting,
even when that same effect remains highlighted in a stale UI. Parameter-only
edits preserve off. Factory effect 22 retains its normal meaning.

Before key apply, still drain the live queue. An error explicitly marked
connectionLost=false may be reported independently while key writes proceed
using their existing backup and readback checks. Keep the configuration error
visible. Unknown errors, lost connections and invalid key baselines stop writes.

## Browser timer correction (v1.1.2)

The default live scheduler wraps both timer functions and invokes them through
globalThis. Storing native setTimeout/clearTimeout directly on the clock object
changed their receiver to that object, causing Illegal invocation in the browser
before the first live batch. Regression tests evaluate the complete UI scripts
with receiver-checking virtual timers, then advance time through automatic SET,
readback and SAVE without calling flush to initiate the updates. The same timer
model covers rescheduling and cancellation. This models browser semantics; it is
not a real browser or physical keyboard acceptance test.

## Realtime configuration (v1.1.1)

Lighting and channel-0 settings are sent automatically after connected UI
changes. A single serialized queue coalesces rapid input (first dispatch after
about 80 ms); events during a slow write retain their latest values. This is
throttling, not a trailing debounce that waits forever while a slider moves.
Key edits remain staged behind the explicit Apply Keys action.

Before each live batch, read affected groups, merge only the requested fields,
and persist the connection's first recovery snapshot before any SET command.
Only changed value IDs are sent. A different live effect selects SYNC so MUSIC
or POMODORO does not hide it. Never resend brightness just to switch an effect.

QMK VIA SET brightness scales the UI byte into RGB_MATRIX_MAXIMUM_BRIGHTNESS;
GET scales the internal integer back. Exact byte equality is therefore not
generally valid. For this adapter, requested-minus-readback brightness may be
0..3; all written non-brightness fields must match exactly. Adopt verified
readback as the baseline, including after rollback. See upstream quantum/via.c:
https://github.com/qmk/qmk_firmware/blob/master/quantum/via.c

Verified live changes are applied without EEPROM-save traffic on every input.
After about 1 second of inactivity, persist each dirty channel once. Disconnect,
explicit exit and key apply flush the queue first. Wait for the Saved status
before unplugging; a page close cannot guarantee delivery of an unsent UI event.
Read/reconnect cancels the old queue before creating another device session.

On errors, restore only attempted fields, probe a read-only key query, refresh
available actual configuration and retain a responding connection. A parameter
or persistence error alone must not be treated as a USB disconnect. Physical
transport failure cancels the queue and requires reconnect. Native diagnostics
include configuration request/reply prefixes, never ordinary keyboard events.

Target: VID `342D`, PID `E545`; Raw HID usage `FF60:0061`.
All values in packet examples below are hexadecimal unless otherwise noted.

## Transport and physical matrix

Preserve the descriptor-driven HID implementation from v1.0.1: Windows
33/65-byte reports include a report-ID byte, WebHID payloads are 32/64 bytes,
and report IDs come from descriptors. Pad to declared output size, normalize
the first 32 input payload bytes, and never assume all VIA devices use 32-byte
USB data reports.

The original manufacturer's definition is 5×15. The third-party CU definition
declares 6×15, including a dummy sixth row. Both describe the same 67 physical
keys in rows 0–4. Read the first 75 coordinates individually and only write
changed physical positions. Never infer a buffer stride from the user's
90-entry saved layers; never write the dummy row or unused switch positions.

| Operation | Request | Value |
| --- | --- | --- |
| Protocol | `01` | Big-endian version at bytes 1–2 |
| Layer count | `11` | Byte 1 |
| Get key | `04 L R C` | Big-endian keycode at bytes 4–5 |
| Set key | `05 L R C HI LO` | Echo, then independent get-key |
| Get lighting | `08 03 ID` | Byte 3; saturation also byte 4 |
| Set lighting | `07 03 ID VALUE...` | Echo, then independent get |
| Persist lighting | `09 03` | Echo |
| Get CU parameter | `08 00 ID` | Byte 3 |
| Set CU parameter | `07 00 ID VALUE` | Echo, then independent get |
| Persist CU parameters | `09 00` | Echo |

Protocols 7–12 are supported for keys; V3 custom channels require 11–12.
Unknown future protocols are rejected. Standard HID keycodes do not change;
legacy/new QMK quantum ranges are detected from Fn / Grave Escape. Unknown
keycodes are retained as raw hex. CU custom slots use the same numeric ranges
but have different meanings, so their labels use the detected firmware profile.

## CU profile

Reference: [packOrTake/weika-nut65-firmware](https://gitee.com/packOrTake/weika-nut65-firmware),
CU V37, master commit `8427691`. The functional definition snapshot is
`reference/nut65-cu-v37.json`; attribution and license are in
`THIRD-PARTY-NOTICES.md`.

The CU hardware has 80 front-strip LEDs plus eight status indicators, without
a full per-key RGB matrix. The preview renders 80 front-edge samples and keeps
keycaps neutral. It illustrates effects, not exact firmware rendering or live
device telemetry.

Lighting channel 3 IDs: 1 brightness, 2 effect, 3 speed, 4 hue+saturation.
**CU menu effect IDs are 0–21 and 23–36; the menu omits 22.** The observed
physical-off state 22 is additionally accepted, but is not listed as a new
animation. There are 35 enabled
effects plus Off. IDs 23–36 are the 14 CU strip effects. The original factory
compatibility adapter retains its separate 0–45 list; never reuse that list to
label or assign CU effects.

CU custom channel 0 uses decimal values:

| ID | Property | Allowed writes |
| --- | --- | --- |
| 1 | sleepTimeout | 0–10: never, 15s, 30s, 1m, 2m, 5m, 10m, 15m, 20m, 25m, 30m |
| 2 | workMinutes | 5, 10, 15, 20, 25, 30, 35 |
| 3 | breakMinutes | 5, 10 |
| 4 | stripMode | 0 SYNC, 1 MUSIC, 3 SPEED, 4 POMODORO |

Connect probes all four parameters read-only. A complete valid response tuple
identifies the CU extension. Echo-only zeros, unsupported replies and invalid
tuples do not enable custom writes. Both the JS adapter and Windows host
validate ranges. The native host unlocks channel-0 writes/saves only after
valid device responses, and resets detection on disconnect/new protocol query.
BAT=2 may be read and preserved in recovery snapshots; it is not offered as a
new USB setting. The native host permits restoring it only if that state was
observed during the connection.

MUSIC uses the keyboard microphone. SPEED and POMODORO are rendered by firmware.
The published menu provides no live WPM, sound levels, timer progress or USB
battery telemetry. Timer start/phase switching and music calibration use
assigned custom keys; do not invent host opcodes or send synthetic keypresses.
RGB controller selection is also a custom key (default Fn+Y), not a menu
parameter. OpenRGB and SignalRGB streaming are outside this VIA adapter.
AI Agent is documented for the standard board and is not exposed as a CU key.

## Transaction and recovery

Validate all proposed values and keycodes before any device operation. Persist
a recoverable snapshot of current keys, lighting, deviceSettings, keycode mode
and firmware profile before the first state-changing command. Preflight keys
and any affected settings against the baseline to catch other software edits.

Write changed keys with independent readback, then lighting and custom settings.
Read each group back before its save command. Add an attempted write to the
rollback set before sending it, since an acknowledgement can fail after a
device mutation. On failure restore attempted groups in reverse order.
A failed restore invalidates the baseline and requires reconnect/recovery.
No success claim is made after an unverified write.

Profile format 2 tags `nutStudio.firmwareProfile` with `packortake-cu-v37` or
`factory`. Untagged v1 profiles and different firmware profiles load their keys,
but their lighting is not silently reinterpreted. Device settings only load
for matching tagged profiles. Profiles contain no fabricated macro state.

The host exposes no firmware updater, reset command, EEPROM erase, macro write,
arbitrary channel write or raw matrix-buffer write. Its loopback service
uses a random launch token, checks Host/Origin, rejects cross-site requests
and validates sizes. Key writes require an explicit apply action. Connected lighting and custom settings use the serialized realtime queue described below.

The CU functionality has simulated protocol/recovery and native-boundary
coverage. New hardware writes and browser visual acceptance remain pending;
unit tests do not establish physical device compatibility.
