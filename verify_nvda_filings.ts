
const fetch = require('node-fetch');

async function test() {
    try {
        const res = await fetch('http://localhost:3000/api/whale-reverse-lookup', {
            method: 'POST',
            body: JSON.stringify({ ticker: 'NVDA' }),
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        console.log(`Match Count: ${data.matchCount}`);
        if (data.funds && data.funds.length > 0) {
            const top = data.funds[0];
            console.log(`Top Fund: ${top.fundName}`);
            console.log(`History Points: ${top.history ? top.history.length : 0}`);
            if (top.history) console.log(JSON.stringify(top.history, null, 2));
        }
    } catch (e) { console.error(e); }
}

test();
