#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import FormData from "form-data";

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
if (!MISTRAL_API_KEY) {
  throw new Error("MISTRAL_API_KEY environment variable is required");
}

const api = axios.create({
  baseURL: "https://api.mistral.ai/v1",
  headers: {
    "Authorization": `Bearer ${MISTRAL_API_KEY}`,
  },
});

const server = new Server(
  {
    name: "mistral-OCR",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "extract_ocr_from_file",
      description: "Upload a PDF/image, perform OCR, and return extracted text",
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Local file path or URL to the PDF/image",
          },
        },
        required: ["file_path"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "extract_ocr_from_file") {
    throw new McpError(ErrorCode.MethodNotFound, "Unknown tool");
  }

  const { file_path } = request.params.arguments as { file_path: string };

  if (!file_path) {
    throw new McpError(ErrorCode.InvalidParams, "file_path is required");
  }

  let fileData: Buffer;
  let filename = "document.pdf";

  try {
    if (file_path.startsWith("http://") || file_path.startsWith("https://")) {
      const response = await axios.get(file_path, { responseType: "arraybuffer" });
      fileData = Buffer.from(response.data);
      filename = path.basename(new URL(file_path).pathname);
    } else {
      fileData = fs.readFileSync(file_path);
      filename = path.basename(file_path);
    }
  } catch (err) {
    throw new McpError(ErrorCode.InternalError, `Failed to load file: ${err}`);
  }

  let fileId: string;
  try {
    const form = new FormData();
    form.append("purpose", "ocr");
    form.append("file", fileData, filename);

    const uploadResp = await api.post("/files", form, {
      headers: form.getHeaders(),
    });
    fileId = uploadResp.data.id;
  } catch (err) {
    throw new McpError(ErrorCode.InternalError, `File upload failed: ${err}`);
  }

  let signedUrl: string;
  try {
    const urlResp = await api.get(`/files/${fileId}/url`, {
      params: { expiry: 1 },
    });
    signedUrl = urlResp.data.url;
  } catch (err) {
    throw new McpError(ErrorCode.InternalError, `Failed to get signed URL: ${err}`);
  }

  try {
    const ocrResp = await api.post("/ocr", {
      model: "mistral-ocr-latest",
      document: {
        type: "document_url",
        document_url: signedUrl,
      },
      include_image_base64: false,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(ocrResp.data, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new McpError(ErrorCode.InternalError, `OCR failed: ${err}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
