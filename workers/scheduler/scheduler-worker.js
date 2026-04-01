export default {
  async fetch(request, env) {
    return new Response("RAG Scheduler Worker is active. This worker handles cron triggers.");
  },

  async scheduled(event, env, ctx) {
    console.log("Cron tick: Checking for scheduled publishes...");
    
    try {
      const response = await fetch(`${env.APP_URL}/api/scheduler/check`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.SCHEDULER_SECRET}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Scheduler check failed with status ${response.status}: ${errorText}`);
        return;
      }

      const data = await response.json();
      console.log("Scheduler check successful:", JSON.stringify(data));
    } catch (error) {
      console.error("Scheduler check failed to execute fetch:", error.message);
    }
  }
};
