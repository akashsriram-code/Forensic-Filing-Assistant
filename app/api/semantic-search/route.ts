import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function POST(req: NextRequest) {
    try {
        const { query } = await req.json();

        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: "Query is required" }, { status: 400 });
        }

        // Call Python script to perform semantic search
        const result = await runPythonSearch(query);

        return NextResponse.json(result);
    } catch (error: any) {
        console.error("[SemanticSearch] Error:", error);
        return NextResponse.json({
            error: error.message || "Search failed",
            results: []
        }, { status: 500 });
    }
}

function runPythonSearch(query: string): Promise<{ results: any[] }> {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(process.cwd(), "scripts", "semantic_search.py");

        const python = spawn("python", [scriptPath, query], {
            cwd: process.cwd(),
            env: process.env
        });

        let stdout = "";
        let stderr = "";

        python.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        python.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        python.on("close", (code) => {
            if (code !== 0) {
                console.error("[SemanticSearch] Python error:", stderr);
                reject(new Error(stderr || "Python script failed"));
                return;
            }

            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (e) {
                console.error("[SemanticSearch] Parse error:", stdout);
                reject(new Error("Failed to parse search results"));
            }
        });
    });
}
