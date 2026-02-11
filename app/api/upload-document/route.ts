import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import { existsSync } from "fs";

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        const company = formData.get("company") as string;
        const period = formData.get("period") as string;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        if (!company || !period) {
            return NextResponse.json({ error: "Company and period are required" }, { status: 400 });
        }

        // Validate file type
        const allowedExtensions = [".pdf", ".docx", ".doc", ".txt"];
        const ext = path.extname(file.name).toLowerCase();
        if (!allowedExtensions.includes(ext)) {
            return NextResponse.json({
                error: `Invalid file type. Allowed: ${allowedExtensions.join(", ")}`
            }, { status: 400 });
        }

        // Save file to temp directory
        const uploadsDir = path.join(process.cwd(), "uploads");
        if (!existsSync(uploadsDir)) {
            await mkdir(uploadsDir, { recursive: true });
        }

        const filename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const filepath = path.join(uploadsDir, filename);

        const bytes = await file.arrayBuffer();
        await writeFile(filepath, Buffer.from(bytes));

        console.log(`[Upload] Saved file: ${filepath}`);

        // Process the document using Python
        const result = await processDocument(filepath, company, period);

        return NextResponse.json({
            success: true,
            filename: file.name,
            company,
            period,
            chunks_indexed: result.chunks_indexed,
            message: `Successfully indexed ${result.chunks_indexed} chunks from ${file.name}`
        });

    } catch (error: any) {
        console.error("[Upload] Error:", error);
        return NextResponse.json({
            error: error.message || "Upload failed"
        }, { status: 500 });
    }
}

function processDocument(filepath: string, company: string, period: string): Promise<{ chunks_indexed: number }> {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(process.cwd(), "scripts", "ingest_document.py");

        const python = spawn("python", [scriptPath, filepath, company, period], {
            cwd: process.cwd(),
            env: process.env
        });

        let stdout = "";
        let stderr = "";

        python.stdout.on("data", (data) => {
            stdout += data.toString();
            console.log("[Upload] Python:", data.toString().trim());
        });

        python.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        python.on("close", (code) => {
            if (code !== 0) {
                console.error("[Upload] Python error:", stderr);
                reject(new Error(stderr || "Document processing failed"));
                return;
            }

            try {
                const result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
                resolve(result);
            } catch (e) {
                // If not JSON, try to extract chunks count
                const match = stdout.match(/Indexed (\d+) chunks/);
                if (match) {
                    resolve({ chunks_indexed: parseInt(match[1]) });
                } else {
                    resolve({ chunks_indexed: 0 });
                }
            }
        });
    });
}
