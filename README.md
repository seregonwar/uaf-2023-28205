# CVE-2023-28205: Apple WebKit Use-After-Free Vulnerability

This vulnerability affects Apple WebKit and can be exploited through
maliciously crafted web content, potentially allowing arbitrary code
execution in the context of the WebKit process.

The affected WebKit build analyzed in this repository is based on
**WebKit-613.1.17.1** (PlayStation / Safari 15.4 lineage).

---

## Description

The proof of concept triggers a **use-after-free (UAF)** condition by
intentionally delaying the registration of JavaScript objects such as
`Map` and `Date` during structured cloning operations.

This timing window allows the **JavaScriptCore Garbage Collector (GC)**
to reclaim objects that are still logically in use, resulting in stale
pointers being dereferenced during continued execution.

---

## Technical Root Cause (CVE-2023-28205)

### Affected Component
- `SerializedScriptValue`
- `CloneDeserializer::deserialize()`

### Root Cause

The vulnerability resides in the **structured clone deserialization
logic**, specifically in how newly created JavaScript objects are tracked
during recursive deserialization.

In `SerializedScriptValue.cpp`, the deserializer uses standard WebKit
containers such as:

```cpp
Vector<JSObject*, 32> outputObjectStack;
Vector<JSMap*, 4> mapStack;
Vector<JSSet*, 4> setStack;
````

These `Vector` containers are **not scanned by the Garbage Collector**.
If a garbage collection cycle is triggered during deserialization
(for example via memory pressure or re-entrant JS execution), objects
referenced *only* by these containers may be incorrectly collected.

The deserializer, however, continues to use these dangling pointers,
resulting in a **use-after-free** condition.

### Missing Fix

The official WebKit security patch (commit `c9880de`) replaces these
containers with `MarkedVector`, a GC-aware structure that properly
registers its contents as GC roots.

In the analyzed build:

* `MarkedVector` is **not implemented**
* `CloneDeserializer` still uses `Vector`
* The GC does not scan these temporary object stacks

This confirms that the build is **fully vulnerable** to CVE-2023-28205. 

---

## Crash Analysis

The following crash was reliably triggered by the PoC and is consistent
with a post-GC stale pointer dereference.

### Key Indicators

* **Signal:** `SIGSEGV (11)`
* **Fault address:** `0x0000000000000068`
* **Process:** `SceNKWebProcess`
* **Module:** `libSceNKWebKit.sprx`

The fault address `0x68` indicates a **NULL base pointer dereference with
an object-field offset**, a classic signature of accessing a freed
JavaScript object.

Register state confirms:

* `RAX = 0x0` (NULL object base)
* Execution entirely within WebKit userland
* No kernel or syscall involvement

This crash behavior is a direct manifestation of the
`CloneDeserializer` UAF described above.

---

## Crash Dump

<details>
<summary>Click to expand crash dump</summary>

```text
#
# A user thread receives a fatal signal
#
# signal: 11 (SIGSEGV)
# thread ID: 101395
# thread name: SceNKWebProcessMain
# proc ID: 88
# proc name: SceNKWebProcess
# reason: page fault (user read data, page not present)
# fault address: 0000000000000068
#
# registers:
# rax: 0000000000000000  rbx: 0000000000000000
# rcx: 000000020017e000  rdx: ffffffff00000000
# rsi: fffe000000000002  rdi: 0000000201d8c000
# rbp: 00000007eeff9f20  rsp: 00000007eeff9dc0
# r8 : 0000000200194c60  r9 : 00000002005ddc70
# r10: 0000000000000004  r11: 0000000000000000
# r12: 0000000200200000  r13: 0000000201d8c000
# r14: 0000000200880a00  r15: 0000000201d8c000
# rip: 0000000804d03bc1  eflags: 00010206
# BrF: 000000080424da9b  BrT: 0000000804d03aa0
#
# backtrace:
copyin: SceNKWebProcessMain has nonsleeping lock
# 000000080424daa0
# 00000008052127b1
# 0000000805224b1b
# 0000000805224b1b
# 0000000805224b92
# 0000000805224b1b
# 0000000805208549
# 00000008037cd403
# 0000000803ed90a5
# 0000000804c48bd2
# 00000008045e2295
# 0000000804073b3b
# 000000080337f214
# 0000000802c62f61
# 0000000803e2b04b
# 0000000804645f82
# 000000080306ddc0
# 0000000803a06adb
# 0000000802e77528
# 0000000804281a70
# 0000000803bff887
# 0000000000405181
# 0000000000403d84
# 00000000004045ef
# 0000000000000000
#
# dynamic libraries:
# /goHvLUnT0D/common/lib/NKWebProcess.self
#  text: 0000000000400000:0000000000408000 r-x
#  data: 000000000040c000:0000000000410000 rw-
#  fingerprint: 9f75275c0c9e6a8f512c46351676ba9c00000000
# /goHvLUnT0D/common/lib/libkernel_web.sprx
#  text: 0000000800000000:0000000800050000 r-x
#  data: 0000000800054000:000000080008c000 rw-
#  fingerprint: 5cc7d026be64eb384dc8edd813cf5dff00000000
# /goHvLUnT0D/common/lib/libSceLibcInternal.sprx
#  text: 000000080008c000:00000008001c0000 r-x
#  data: 00000008001c8000:00000008001e4000 rw-
#  fingerprint: 10c2fb20aecfba270ab36512cc6bcd3c00000000
# /goHvLUnT0D/common/lib/libSceSysmodule.sprx
#  text: 00000008001e4000:00000008001f0000 r-x
#  data: 00000008001f4000:0000000800200000 rw-
#  fingerprint: d53329218364300cfc9ac1ce2f5f319000000000
# /goHvLUnT0D/common/lib/libScePosixForWebKit.sprx
#  text: 0000000800200000:0000000800204000 r-x
#  data: 0000000800208000:000000080020c000 rw-
#  fingerprint: 2540b10c69fafebe19bf6c817f06a5dd00000000
# /goHvLUnT0D/common/lib/libcairo.sprx
#  text: 000000080020c000:0000000800318000 r-x
#  data: 0000000800320000:0000000800324000 rw-
#  fingerprint: 66924f66c3b2bcfd5877f0b6b53b17c800000000
# /goHvLUnT0D/common/lib/libcurl.sprx
#  text: 0000000800324000:00000008003d0000 r-x
#  data: 00000008003d4000:00000008003d8000 rw-
#  fingerprint: d07498e9ec79386fc781c8feeea9aa2800000000
# /goHvLUnT0D/common/lib/libfontconfig.sprx
#  text: 00000008003d8000:0000000800450000 r-x
#  data: 0000000800454000:0000000800458000 rw-
#  fingerprint: f588f705527618061e0a9e633018197300000000
# /goHvLUnT0D/common/lib/libfreetype.sprx
#  text: 0000000800458000:0000000800500000 r-x
#  data: 0000000800508000:000000080050c000 rw-
#  fingerprint: 55f0bf21e56f35c305acd791696e05b100000000
# /goHvLUnT0D/common/lib/libharfbuzz.sprx
#  text: 000000080050c000:00000008005cc000 r-x
#  data: 00000008005d0000:00000008005d4000 rw-
#  fingerprint: 0e11f91a091308d571226554af07ce4000000000
# /goHvLUnT0D/common/lib/libicu.sprx
#  text: 00000008005d4000:0000000802504000 r-x
#  data: 0000000802524000:0000000802528000 rw-
#  fingerprint: 1ef63fd860c70ff5f8744411e1ba581800000000
# /goHvLUnT0D/common/lib/libpng16.sprx
#  text: 0000000802528000:000000080255c000 r-x
#  data: 0000000802560000:0000000802564000 rw-
#  fingerprint: 1bb1e4c3acb314d2dd52df2ca6a7a03e00000000
# /goHvLUnT0D/common/lib/libSceIpmi.sprx
#  text: 0000000802564000:0000000802570000 r-x
#  data: 0000000802574000:0000000802588000 rw-
#  fingerprint: d5f95ff9044c26f90ff63c82fb0bbf5c00000000
# /goHvLUnT0D/common/lib/libSceSysCore.sprx
#  text: 0000000802588000:0000000802590000 r-x
#  data: 0000000802594000:0000000802598000 rw-
#  fingerprint: d577567a554a7563ef2327c820bf0ee200000000
# /goHvLUnT0D/common/lib/libSceNet.sprx
#  text: 0000000802598000:00000008025d0000 r-x
#  data: 00000008025d4000:00000008026e8000 rw-
#  fingerprint: 979f14da6d4c7aa75cdd4d4b2f3281c900000000
# /goHvLUnT0D/common/lib/libSceNetCtl.sprx
#  text: 00000008026e8000:00000008026f0000 r-x
#  data: 00000008026f4000:00000008026f8000 rw-
#  fingerprint: 162fbdf7aa83706cc0992108ca3393ae00000000
# /goHvLUnT0D/common/lib/libSceRandom.sprx
#  text: 00000008026f8000:00000008026fc000 r-x
#  data: 0000000802700000:0000000802704000 rw-
#  fingerprint: 976d3ebefe3870b97bfa1d8e82f1df2d00000000
# /goHvLUnT0D/common/lib/libSceLibreSsl3.sprx
#  text: 0000000802704000:000000080288c000 r-x
#  data: 00000008028ac000:00000008028b0000 rw-
#  fingerprint: bd895ec678ab2becafd45e954fba828400000000
# /goHvLUnT0D/common/lib/libSceRegMgr.sprx
#  text: 00000008028b0000:00000008028b4000 r-x
#  data: 00000008028b8000:00000008028bc000 rw-
#  fingerprint: 50fe32bc796e1dbda2337287e42091d100000000
# /goHvLUnT0D/common/lib/libSceSystemService.sprx
#  text: 00000008028bc000:00000008028f8000 r-x
#  data: 00000008028fc000:0000000802908000 rw-
#  fingerprint: 6fead8bbcbbf7002bee44d4d2104c8d300000000
# /goHvLUnT0D/common/lib/libSceMbus.sprx
#  text: 0000000802908000:0000000802914000 r-x
#  data: 0000000802918000:000000080291c000 rw-
#  fingerprint: eaf5e1ec79a60c0293ad42c039a9ff1a00000000
# /goHvLUnT0D/common/lib/libSceAvSetting.sprx
#  text: 000000080291c000:0000000802928000 r-x
#  data: 000000080292c000:0000000802930000 rw-
#  fingerprint: 6a745bdbf97da42d23745852daa2afc700000000
# /goHvLUnT0D/common/lib/libSceVideoOut.sprx
#  text: 0000000802930000:0000000802948000 r-x
#  data: 000000080294c000:0000000802950000 rw-
#  fingerprint: 504c9ecf78fdc9adf3fcd3721dc3975100000000
# /goHvLUnT0D/common/lib/libSceVideoCoreServerInterface.sprx
#  text: 0000000802950000:0000000802960000 r-x
#  data: 0000000802964000:000000080296c000 rw-
#  fingerprint: 4613f400001d613dda147326d8ef133900000000
# /goHvLUnT0D/common/lib/libSceNKWebKitRequirements.sprx
#  text: 000000080296c000:0000000802bdc000 r-x
#  data: 0000000802be0000:0000000802be8000 rw-
#  fingerprint: aa200eff9a5fd90b0c6f12853aa1cbd200000000
# /goHvLUnT0D/common/lib/libSceNKWebKit.sprx
#  text: 0000000802be8000:00000008060b8000 r-x
#  data: 00000008062c0000:00000008062f8000 rw-
#  fingerprint: bc8a78e3ddb906f6d0de352329701c2600000000
# /goHvLUnT0D/common/lib/libSceGLSlimClientVSH.sprx
#  text: 00000008062f8000:0000000806318000 r-x
#  data: 000000080631c000:0000000806320000 rw-
#  fingerprint: 1cea1ecf4ffd91dc02ca2b7bc92c3c0a00000000
<118>[Syscore App] App Crash : PID=0x58, reason=0xb
<118>[Syscore App] Syscore Event Queue Push : SCE_SYSCORE_EVENT_APP_CRASH
<118>[Syscore App] Syscore Event Queue Pop : SCE_SYSCORE_EVENT_APP_CRASH
<118>[SceLncService] AppCrash: pid={0x00000058} appId={0x60000201} appLocalPid={0x102012a5}
<118>[SceLncService] getCoredumpSequence() isDebuggable={0} isKeepProcess={1} isUserDebugRequest={0} isLimitKeepProcess={0} enableCrashReport={1}
<118>[SceLncService] CoredumpSequence = {DUMP_PROCESS}
<118>[SceLncService] getCoredumpMode() isSystem={0x00000001}, reason={0x0000000b}
<118>[SceLncService] notifyAppCrash() pid={0x00000058}, appId={0x60000201}, appLocalPid={0x102012a5}, coredump.path,name,mode={/user/data/sce_coredumps/NPXS20001_1767544376/,NPXS20001_1767544376.sorbisdmp,1}, enableCrashReport={1}, skipVshDump={0}
<118>[SceLncService] enableCrashReport={1}, crashReportMode={1}, isAllowed={0}
<118>[SceLncService] kick coredump is disabled.
<118>[Syscore App] Kill process: 0x58
<118>[VCS]closeSession() [APP->VCS] clientPid = 0x58.
<118>[Syscore App] EVFILT_PROC NOTE_EXIT received : pid=0x58
<118>[Syscore App] Kill process: 0x58 => 0
<118>[Syscore App] process delete event : pid=0x58
<118>[AppMgr Trace]: pid=0x58, deleted.
<118>[Syscore App] Syscore Event Queue Push : SCE_SYSCORE_EVENT_ON_PROCESS_UNLOADED
<118>[AppMgr] checkAppTerminated pid=0x2a is still alive in 0x60000201
<118>[Syscore App] Syscore Event Queue Pop : SCE_SYSCORE_EVENT_ON_PROCESS_UNLOADED
<118>[SceShellUI] W/PSM.UI : ** NOTICE: LoadSync : Parent_BrowserMain : FrameModalScene
<118>[SceShellUI] I/PSM.UI : OnFocusActiveSceneChanged [BrowserMain : MainScene] -> [Parent_BrowserMain : FrameModalScene]
<118>[SceShellUI] I/PSM.UI :      Scene [Parent_BrowserMain : FrameModalScene] : Alive
<118>SetDeviceIndexBehavior: mode=SpecificUser, param=0x1a599820
<118>[Theme/I] : Apply [RED] : [Option:111111]: with preloaded user
<118>[SceShellCore] Libc Heap Status: free 38%, in-use 3794.3 KB, trend +18.1 KB/min, peak 4267.3 KB, when 19698 [sec]
<118>[SceShellCore] VM Stats: RSS 533.4, kernel 271.1, wire count 332.2, swap out 24.2, page table CPU 2526/6144 GPU 271/2048
```

</details>

---

## Exploitation Notes

The vulnerability provides a **stable UAF primitive** reachable via
`postMessage`:

1. A complex object graph is sent via `postMessage`
2. Deserialization triggers recursive object creation
3. A GC cycle is forced during deserialization
4. Objects referenced only in non-GC-safe containers are freed
5. Deserialization continues using dangling pointers

This allows controlled memory corruption of JavaScriptCore internal
structures (e.g. `StructureID`, butterfly pointers), making this bug a
strong candidate for **reliable exploitation** with proper heap shaping. 

---

## References

* WebKit security patch:
  [https://github.com/WebKit/WebKit/commit/c9880de4a28b9a64a5e1d0513dc245d61a2e6ddb](https://github.com/WebKit/WebKit/commit/c9880de4a28b9a64a5e1d0513dc245d61a2e6ddb)

---

## Credits

CVE-2023-28205 was discovered by **Clément Lecigne**
(Google Threat Analysis Group) and **Donncha Ó Cearbhaill**
(Amnesty International Security Lab).

Thanks to **abc** for the original proof-of-concept inspiration.


