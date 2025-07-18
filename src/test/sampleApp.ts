
// test.ts - Event Loop Visualization Test File
// This file contains various sync/async operations to test event loop visualization

console.log('=== Event Loop Test Starting ===');

// Synchronous operations
console.log('1. Synchronous operation');

// Macrotask: setTimeout (Timer phase)
setTimeout(() => {
    console.log('2. setTimeout callback (Timer phase)');
}, 0);

// Microtask: process.nextTick (highest priority)
process.nextTick(() => {
    console.log('3. process.nextTick callback (Microtask - highest priority)');
});

// Macrotask: setImmediate (Check phase)
setImmediate(() => {
    console.log('4. setImmediate callback (Check phase)');
});

// Microtask: Promise.resolve
Promise.resolve().then(() => {
    console.log('5. Promise.resolve callback (Microtask)');
});

// More complex Promise chain
const complexPromise = new Promise<string>((resolve, reject) => {
    console.log('6. Inside Promise constructor (Synchronous)');
    resolve('Promise resolved');
});

complexPromise.then((result) => {
    console.log('7. Promise.then callback:', result);
    return 'Chained result';
}).then((chainedResult) => {
    console.log('8. Chained Promise.then callback:', chainedResult);
});

// Async function demonstration
async function asyncFunction() {
    console.log('9. Inside async function (Synchronous part)');
    
    await new Promise<string>(resolve => {
        setTimeout(() => {
            console.log('10. Async await with setTimeout');
            resolve('Async resolved');
        }, 10);
    });
    
    console.log('11. After await in async function');
}

// Call async function
asyncFunction();

// Multiple nested setTimeout with different delays
setTimeout(() => {
    console.log('12. setTimeout 5ms');
    
    process.nextTick(() => {
        console.log('13. process.nextTick inside setTimeout');
    });
    
    Promise.resolve().then(() => {
        console.log('14. Promise inside setTimeout');
    });
}, 5);

setTimeout(() => {
    console.log('15. setTimeout 15ms');
}, 15);

// Microtask: multiple process.nextTick
process.nextTick(() => {
    console.log('16. First process.nextTick');
    
    process.nextTick(() => {
        console.log('17. Nested process.nextTick');
    });
});

// I/O operation simulation
import * as fs from 'fs';
import * as path from 'path';

// Async I/O operation
fs.readFile(__filename, 'utf8', (err, data) => {
    if (err) {
        console.log('18. File read error:', err.message);
    } else {
        console.log('19. File read complete (I/O callback)');
    }
});

// Immediate callback with nested operations
setImmediate(() => {
    console.log('20. setImmediate with nested operations');
    
    // Nested microtasks
    process.nextTick(() => {
        console.log('21. process.nextTick inside setImmediate');
    });
    
    Promise.resolve().then(() => {
        console.log('22. Promise inside setImmediate');
    });
    
    // Nested macrotask
    setTimeout(() => {
        console.log('23. setTimeout inside setImmediate');
    }, 0);
});

// Promise rejection handling
Promise.reject(new Error('Test error')).catch((error) => {
    console.log('24. Promise rejection caught:', error.message);
});

// Multiple Promise.all
Promise.all([
    Promise.resolve('First'),
    Promise.resolve('Second'),
    new Promise<string>(resolve => setTimeout(() => resolve('Third'), 20))
]).then((results) => {
    console.log('25. Promise.all results:', results);
});

// Event emitter simulation
import { EventEmitter } from 'events';

const emitter = new EventEmitter();

emitter.on('test', (data) => {
    console.log('26. Event emitter callback:', data);
});

// Emit event asynchronously
setImmediate(() => {
    emitter.emit('test', 'Event data');
});

// Generator function with async operations
function* asyncGenerator() {
    console.log('27. Generator function start');
    
    yield new Promise<string>(resolve => {
        setTimeout(() => {
            console.log('28. Generator yield with setTimeout');
            resolve('Generator value');
        }, 25);
    });
    
    console.log('29. Generator function end');
}

// Using the generator
const gen = asyncGenerator();
gen.next().value?.then?.((result) => {
    console.log('30. Generator result:', result);
});

// Final synchronous operation
console.log('31. Final synchronous operation');

// HTTP request simulation
import * as https from 'https';

const options = {
    hostname: 'httpbin.org',
    port: 443,
    path: '/get',
    method: 'GET',
    timeout: 5000
};

const req = https.request(options, (res) => {
    console.log('32. HTTP request response received');
    res.on('data', (chunk) => {
        console.log('33. HTTP data chunk received');
    });
    res.on('end', () => {
        console.log('34. HTTP request completed');
    });
});

req.on('error', (error) => {
    console.log('35. HTTP request error:', error.message);
});

req.on('timeout', () => {
    console.log('36. HTTP request timeout');
    req.destroy();
});

req.end();

console.log('=== Event Loop Test Setup Complete ===');

// Export for potential module usage
export { asyncFunction, asyncGenerator };
