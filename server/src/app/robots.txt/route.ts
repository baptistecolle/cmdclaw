export async function GET() {
  const robotsTxt = `User-agent: *
Disallow: /
`;

  return new Response(robotsTxt, {
    headers: {
      "Content-Type": "text/plain",
    },
  });
}
