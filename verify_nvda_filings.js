
async function test() {
    try {
        const res = await fetch('http://localhost:3000/api/whale-reverse-lookup', {
            method: 'POST',
            body: JSON.stringify({ ticker: 'NVDA' }),
            headers: { 'Content-Type': 'application/json' }
        });
        const text = await res.text();
        console.log("Raw Response:", text);
        try {
            const data = JSON.parse(text);
            console.log(`Match Count: ${data.matchCount}`);
        } catch (e) { }

    } catch (e) { console.error(e); }
}

test();
