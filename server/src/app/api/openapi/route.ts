import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { appRouter } from "@/server/orpc";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

export async function GET() {
  const spec = await generator.generate(appRouter, {
    info: {
      title: "BAP API",
      version: "0.1.0",
      description: "API for BAP server",
    },
    servers: [{ url: "/api/rpc" }],
  });

  return Response.json(spec);
}
