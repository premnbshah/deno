import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";

const app = new Hono();

app.post("/api/escalation", async (c) => {
  try {
    const body = await c.req.json();
    const operation = c.req.query("operation");

    if (!body) {
      return c.json({ error: "Body is required" }, 400);
    }

    if (!operation) {
      return c.json({ error: "Operation query parameter is required" }, 400);
    }

    if (operation === "sendToSheety") {
      return await sendToSheety(c);
    } else if (operation === "offlineHours") {
      return await offlineHours(c);
    } else {
      return c.json({ error: "Invalid operation" }, 400);
    }
  } catch (error) {
    console.error("Request failed:", error.message);
    return c.json({ error: "Request failed", details: error.message }, 500);
  }
});

async function sendToSheety(c) {
  try {
    const body = await c.req.json();
    console.log("sendToSheety", body);

    if (!body) {
      return c.json({ error: "Body is required" }, 400);
    }

    const {
      conversationId,
      servicerequestId,
      userid,
      marketplace,
      warehouseName,
    } = body;

    if (!conversationId || !servicerequestId) {
      return c.json(
        {
          error: "conversationId and servicerequestId are required in the body",
        },
        400
      );
    }

    const chatUrl = `https://app.bot9.ai/inbox/${conversationId}?status=bot&search=`;

    console.log("Fetching current sheet entries...");

    // Fetch current sheet entries
    const sheetResponse = await fetch(
      "https://api.sheety.co/011fae6ddb1f69495d3220937f85baff/stagingRento/opsCallback"
    );

    if (!sheetResponse.ok) {
      const errorText = await sheetResponse.text();
      console.error(
        "Failed to fetch data from Sheety:",
        sheetResponse.statusText,
        errorText
      );
      return c.json(
        { error: "Failed to fetch data from Sheety", details: errorText },
        500
      );
    }

    const sheetData = await sheetResponse.json();
    console.log("Sheet data fetched successfully:", sheetData);

    const existingEntry = sheetData.opsCallback.find(
      (entry) => entry.servicerequestId === servicerequestId
    );

    if (existingEntry) {
      console.log("Service request already exists, sending email...");

      const cityUserIds = {
        bangalore: [1732788, 1237084, 98143],
        mumbai: [1732814, 1497288, 98143],
        pune: [1732815, 1497288, 98143],
        delhi: [1732816, 96493, 98143],
        noida: [1732818, 96493, 98143],
        gurgaon: [1732819, 96493, 98143],
        hyderabad: [1732820, 1237084, 98143],
        chennai: [1732821, 1237084, 98143],
        ahmedabad: [1732823, 96493, 98143],
        mysore: [1732824, 1237084, 98143],
        jaipur: [1732825, 96493, 98143],
        faridabad: [1732827, 96493, 98143],
        ghaziabad: [1732829, 96493, 98143],
        gandhinagar: [1732830, 96493, 98143],
        chandigarh: [1732831, 96493, 98143],
        lucknow: [1732833, 96493, 98143],
        kolkata: [1732835, 1497288, 98143],
        indore: [1732836, 96493, 98143],
        kochi: [1681241, 399618, 1237084, 98143],
        hosur: [1732847, 1237084, 98143],
        pondicherry: [1732840, 1237084, 98143],
      };

      // Get the city from the body and normalize it
      const city = body.city ? body.city.trim().toLowerCase() : "";

      // Get userIds for the city
      let userIds = cityUserIds[city];

      if (!userIds) {
        console.warn(
          `City "${city}" not found in mapping. Using default userIds.`
        );
        userIds = [98143]; // Default userIds
      }

      // Add marketplace-specific userIds
      if (marketplace === true) {
        userIds = [...new Set([...userIds, 992811, 98143])];
      }

      // Prepare email body according to the provided curl example
      const emailBody = {
        userIds: userIds,
        channels: ["EMAIL"],
        type: "Bot9_Email_Internal2",
        name: "bot9 mail",
        duplicateCheck: true,
        variables: {
          userId: userid,
          ticketId: servicerequestId,
          comment: body.voiceofCustomer,
          locationName: body.city,
          requestTypeLabel: body.requestType,
        },
      };

      // Send email request
      const emailResponse = await fetch(
        "https://centercom.rentomojo.com/api/communications/key/send/bulk",
        {
          method: "POST",
          headers: {
            ApiKey: "79kzTYf3oNDNsnpX823232JYYAym1Ep43.bot9",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(emailBody),
        }
      );

      if (!emailResponse.ok) {
        const errorText = await emailResponse.text();
        console.error("Failed to send email:", errorText);
        return c.json(
          { error: "Failed to send email", details: errorText },
          emailResponse.status
        );
      }

      const emailData = await emailResponse.json();
      console.log("Email sent successfully:", emailData);

      return c.json({
        message: "Email sent successfully for existing service request",
        emailData,
      });
    } else {
      console.log("Service request not found, creating new entry in sheet...");

      // Send the updated ChatUrl to Sheety
      const sheetyResponse = await fetch(
        "https://api.sheety.co/011fae6ddb1f69495d3220937f85baff/stagingRento/opsCallback",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            opsCallback: {
              ...body,
              chatUrl: chatUrl,
              marketplace: marketplace,
              warehouse: warehouseName,
            },
          }),
        }
      );

      if (!sheetyResponse.ok) {
        const errorText = await sheetyResponse.text();
        console.error(
          "Failed to send data to Sheety:",
          sheetyResponse.statusText,
          errorText
        );
        return c.json(
          { error: "Failed to send data to Sheety", details: errorText },
          500
        );
      }

      const responseData = await sheetyResponse.json();
      console.log("sendToSheety done:", responseData);
      return c.json(responseData);
    }
  } catch (error) {
    console.error("Request failed:", error.message);
    return c.json({ error: "Request failed", details: error.message }, 500);
  }
}

async function offlineHours(c) {
  const body = await c.req.json();

  if (!body) {
    return c.json({ error: "Body is required" }, 400);
  }

  const { conversationId, marketplace } = body;

  if (!conversationId) {
    return c.json({ error: "conversationId is required in the body" }, 400);
  }

  const chatUrl = `https://app.bot9.ai/inbox/${conversationId}?status=bot&search=`;

  try {
    const response = await fetch(
      "https://api.sheety.co/011fae6ddb1f69495d3220937f85baff/stagingRento/offlineHours",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          offlineHour: { ...body, chatUrl: chatUrl, marketplace: marketplace },
        }),
      }
    );

    if (!response.ok) {
      console.error("Failed to send data to Sheety:", response.statusText);
      return c.json({ error: "Failed to send data to Sheety" }, 500);
    }

    const responseData = await response.json();
    console.log(responseData);
    return c.json(responseData);
  } catch (error) {
    console.error("Request failed:", error.message);
    return c.json({ error: "Request failed", details: error.message }, 500);
  }
}

export default app;
