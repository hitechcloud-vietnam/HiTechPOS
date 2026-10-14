# Devices: first delivery milestone

Open **More → Devices** to choose camera scanning, external keyboard-mode
barcode scanning, the phone print service or the configured Till printer.
These are available workflows, not a list of physically connected peripherals.
Permissions and the offline grant control which actions are enabled.

Pair an external scanner in the phone's OS settings, select its keyboard/HID
mode and configure an Enter suffix. Open **External barcode scanner**, focus
the input and scan. Leave the page to stop. The app preserves leading zeroes
and requires one active item with an exact matching barcode. It does not use
product names or internal item numbers as barcode fallbacks. Product QR codes
must contain the literal catalogue barcode; GS1 URL parsing is a later milestone.

For a quick training check, enter `POSNIC-DEMO-11` and press Enter twice. The
current sale should contain two Filter coffees (₹70). Test with internet off.
No real payment or server write occurs in training mode.

Rapid input is saved through a bounded, ordered queue. Backgrounding/locking
cancels scans that have not started; an already-started atomic item add finishes.
Review the cart after interruption. A full queue reports a pause rather than
silently treating another barcode as saved.

After a live receipt has been queued for the Till, use **Refresh** on its receipt
details to inspect its job state. This requires the matched API's `printStatus`
capability. Completion is reported by the Till and is not proof of physical
paper delivery. A status read never creates another print request.

Android Bluetooth Classic SPP and USB printer-class bulk ESC/POS direct printing
are implemented in the [offline beta](OFFLINE_DIRECT_PRINT_BETA.md). Configure the
exact printer, paper width and optional printer-connected cash drawer in
**More → Printing**. Permission/identity failures never fall back to another device.
The drawer pulses only on the first cash receipt attempt, never a retry/reprint.
Uncertain writes require explicit paper inspection and recovery.

Weighed-item scans open quantity entry in the configured unit. Queued HID scans
are explicitly paused while entering weight; scan remaining items again afterward.
This is manual quantity entry, not an attached-scale adapter. iOS direct adapters,
scales and provider card terminals remain outside this build. Software checks do
not certify a physical model; use the pilot test guide with the actual hardware.

See `Intranet/docs/MOBILE_POS_HARDWARE_DELIVERY_ROADMAP.md` in the companion Intranet
repository for the full milestone backlog and acceptance gates, and
[Access control](ACCESS_CONTROL.md) for the existing permission mapping.
