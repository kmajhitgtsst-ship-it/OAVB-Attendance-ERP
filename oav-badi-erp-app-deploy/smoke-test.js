const http = require("http");

function request(path, method = "GET", body) {
  const payload = body ? JSON.stringify(body) : "";
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "localhost",
      port: process.env.PORT || 3050,
      path,
      method,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
      }
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        const parsed = res.headers["content-type"]?.includes("application/json") ? JSON.parse(data) : data;
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

(async () => {
  const home = await request("/");
  if (home.status !== 200 || !home.data.includes("OAV BADI Attendance ERP")) throw new Error("Home page failed");
  const bootstrap = await request("/api/bootstrap");
  if (bootstrap.status !== 200 || !Array.isArray(bootstrap.data.students)) throw new Error("Bootstrap failed");
  console.log("Smoke test passed");
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
