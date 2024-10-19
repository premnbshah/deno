import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";

const app = new Hono();

// Billing

const baseurl = "https://www.rentomojo.com";

app.get("/api/billingAndPayments", async (c) => {
  const token = c.req.query("token");
  const userId = c.req.query("userId");
  const invoiceId = c.req.query("invoiceId");

  if (!token) {
    return c.json({ error: "Token is required" }, 400);
  }

  try {
    // GetRentalDue
    if (!userId && !invoiceId) {
      const response = await fetch(baseurl + "/api/Dashboards/dashboardData", {
        headers: {
          accept: "application/json, text/plain, */*",
          authorization: token,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch rental due data: ${response.statusText}`
        );
      }

      const data = await response.json();
      return c.json({
        type: "RentalDue",
        data: {
          pendingDuesText: data.pendingDuesText,
          totalPendingRentalDueAmount: data.totalPendingRentalDueAmount,
          totalPayableAmount: data.totalPayableAmount,
          pendingLateFeeAmount: data.pendingLateFeeAmount,
          rentoMoney: data.rentoMoney,
        },
      });
    }

    // GetPendingDues
    if (userId && !invoiceId) {
      const response = await fetch(
        baseurl + `/api/RMUsers/getPendingRentalItemsBreakUp?userId=${userId}`,
        {
          headers: {
            "accept-language": "en-GB,en;q=0.9",
            authorization: token,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch pending dues: ${response.statusText}`);
      }

      const data = await response.json();
      return c.json({
        type: "PendingDues",
        data: data,
      });
    }

    // GetInvoices
    if (!userId && !invoiceId) {
      const response = await fetch(baseurl + `/api/Dashboards/getLedgersData`, {
        headers: {
          authorization: token,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch invoices: ${response.statusText}`);
      }

      const data = await response.json();
      const formattedData = data.invoices.map((invoice) => ({
        id: invoice.id,
        createdAt: invoice.createdAt,
        invoiceMonth: invoice.invoiceMonth,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        paymentStatus: invoice.paymentStatus === 20 ? "Paid" : "Unpaid",
        invoicePaidDate: invoice.invoicePaidDate,
      }));

      return c.json({
        type: "Invoices",
        data: { invoices: formattedData },
      });
    }

    // GetUserInvoice
    if (userId && invoiceId) {
      const response = await fetch(
        baseurl +
          `/api/RMUsers/${userId}/getUserLedgerInvoice?invoiceId=${invoiceId}&discardGstInvoiceDateCheck=true`,
        {
          headers: {
            authorization: token,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch user invoice: ${response.statusText}`);
      }

      const data = await response.json();
      const formattedData = {
        id: data.id,
        invoiceDate: data.invoiceDate,
        userId: data.userId,
        invoiceNumber: data.invoiceNumber,
        address: data.address,
        rentAmount: data.rentAmount,
        paymentStatus: data.paymentStatus === 20 ? "Paid" : "Unpaid",
        invoiceUrl: `${baseurl}/dashboard/my-subscriptions/${data.id}/rental-invoice`,
        orderItemRents: data.orderItemRents.map((orderItemRent) => ({
          rentAmount: orderItemRent.rentAmount,
          billingCycleStartDate: orderItemRent.billingCycleStartDate,
          billingCycleEndDate: orderItemRent.billingCycleEndDate,
          dueDate: orderItemRent.dueDate,
          rentalMonth: orderItemRent.rentalMonth,
          productName: orderItemRent.orderItem.product.name,
          orderUniqueId: orderItemRent.orderItem.order.uniqueId,
        })),
      };

      return c.json({
        type: "UserInvoice",
        data: formattedData,
      });
    }

    return c.json({ error: "Invalid combination of parameters" }, 400);
  } catch (error) {
    console.error("Request failed:", error.message);
    return c.json({ error: "Request failed", details: error.message }, 500);
  }
});

// Escalation

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

// Service Management

app.get("/api/orderServiceManagement", async (c) => {
  const token = c.req.query("token");
  const operation = c.req.query("operation");

  if (!token) {
    return c.json({ error: "Token is required" }, 400);
  }

  if (!operation) {
    return c.json({ error: "Operation is required" }, 400);
  }

  try {
    switch (operation) {
      case "getServiceRequests":
        return await getServiceRequests(c, token);
      case "showServiceRequests":
        return await showServiceRequests(c, token);
      case "getDeliverySlots":
        return await getDeliverySlots(c, token);
      default:
        return c.json({ error: "Invalid operation" }, 400);
    }
  } catch (error) {
    console.error("Request failed:", error.message);
    return c.json({ error: "Request failed", details: error.message }, 500);
  }
});

app.post("/api/orderServiceManagement", async (c) => {
  const token = c.req.query("token");
  const operation = c.req.query("operation");

  if (!token) {
    return c.json({ error: "Token is required" }, 400);
  }

  if (!operation) {
    return c.json({ error: "Operation is required" }, 400);
  }

  try {
    switch (operation) {
      case "bookCssSlot":
        return await bookCssSlot(c, token);
      case "rescheduleRequest":
        return await rescheduleRequest(c, token);
      case "createRepairTicket":
        return await createRepairTicket(c, token);
      case "cancelServiceRequest":
        return await cancelServiceRequest(c, token);
      default:
        return c.json({ error: "Invalid operation" }, 400);
    }
  } catch (error) {
    console.error("Request failed:", error.message);
    return c.json({ error: "Request failed", details: error.message }, 500);
  }
});

async function getServiceRequests(c: any, token: string) {
  const response = await fetch(
    baseurl +
      "/api/Dashboards/getServiceRequest?query=%7B%22page%22:1,%22size%22:100%7D&activeStatus=active",
    {
      headers: {
        accept: "application/json, text/plain, */*",
        authorization: token,
        "chat-app": "bot9",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch service requests: ${response.statusText}`);
  }

  const data = await response.json();
  return c.json({ type: "ServiceRequests", data: data.results });
}

async function showServiceRequests(c: any, token: string) {
  // This function might be similar to getServiceRequests, but with different formatting
  // For this example, we'll use the same endpoint but format the data differently
  const response = await fetch(
    baseurl +
      "/api/Dashboards/getServiceRequest?query=%7B%22page%22:1,%22size%22:100%7D&activeStatus=active",
    {
      headers: {
        accept: "application/json, text/plain, */*",
        authorization: token,
        "chat-app": "bot9",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch service requests: ${response.statusText}`);
  }

  const data = await response.json();
  const formattedData = data.results.map((request: any) => ({
    id: request.serviceRequestId,
    type: request.requestType.label,
    status: request.requestStatus.label,
    createdAt: request.createdAt,
  }));

  return c.json({ type: "FormattedServiceRequests", data: formattedData });
}

async function getDeliverySlots(c: any, token: string) {
  const { orderUniqueId, requestType } = await c.req.json();

  if (!orderUniqueId || !requestType) {
    return c.json({ error: "orderUniqueId and requestType are required" }, 400);
  }

  const response = await fetch(baseurl + "/api/ServiceRequests/getCssSlots", {
    method: "POST",
    headers: {
      authorization: token,
      "Content-Type": "application/json",
      "chat-app": "bot9",
    },
    body: JSON.stringify({
      data: {
        orderUniqueId: orderUniqueId,
        requestType: requestType,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch delivery slots: ${response.statusText}`);
  }

  const data = await response.json();
  return c.json({ type: "DeliverySlots", data: data });
}

async function bookCssSlot(c: any, token: string) {
  const { serviceRequestId, taskDateTime } = await c.req.json();

  if (!serviceRequestId || !taskDateTime) {
    return c.json(
      { error: "serviceRequestId and taskDateTime are required" },
      400
    );
  }

  const response = await fetch(baseurl + "/api/ServiceRequests/bookCssSlot", {
    method: "POST",
    headers: {
      authorization: token,
      "Content-Type": "application/json",
      "chat-app": "bot9",
    },
    body: JSON.stringify({
      data: {
        serviceRequestId: serviceRequestId,
        taskDateTime: taskDateTime,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to book CSS slot: ${response.statusText}`);
  }

  const data = await response.json();
  return c.json({ type: "BookedCssSlot", data: data });
}

async function rescheduleRequest(c: any, token: string) {
  const { serviceRequestId, preferredDate } = await c.req.json();

  if (!serviceRequestId || !preferredDate) {
    return c.json(
      { error: "serviceRequestId and preferredDate are required" },
      400
    );
  }

  const response = await fetch(
    baseurl + "/api/ServiceRequests/cssRescheduleTicket",
    {
      method: "POST",
      headers: {
        authorization: token,
        "Content-Type": "application/json",
        "chat-app": "bot9",
      },
      body: JSON.stringify({
        data: {
          serviceRequestId: serviceRequestId,
          preferredDate: preferredDate,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to reschedule request: ${response.statusText}`);
  }

  const data = await response.json();
  return c.json({ type: "RescheduledRequest", data: data });
}

async function createRepairTicket(c: any, token: string) {
  const { media1, media2, media3, media4, description, orderId } =
    await c.req.json();

  const mediaUrls = [media1, media2, media3, media4].filter(Boolean);

  if (mediaUrls.length === 0) {
    return c.json({ error: "At least one image URL is required" }, 400);
  }

  // Upload images
  const uploadResponse = await fetch(
    baseurl + "/api/ServiceRequestImages/urlUpload",
    {
      method: "POST",
      headers: {
        accept: "*/*",
        authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ imageUrls: mediaUrls }),
    }
  );

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload images: ${uploadResponse.statusText}`);
  }

  const uploadedImages = await uploadResponse.json();

  // Create ticket
  const ticketResponse = await fetch(
    baseurl + "/api/Dashboards/createNewTickets",
    {
      method: "POST",
      headers: {
        authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: [
          {
            requestType: 20,
            images: uploadedImages,
            orderItemId: parseInt(orderId),
            message: description,
          },
        ],
      }),
    }
  );

  if (!ticketResponse.ok) {
    throw new Error(
      `Failed to create repair ticket: ${ticketResponse.statusText}`
    );
  }

  const ticketData = await ticketResponse.json();
  return c.json({ type: "CreatedRepairTicket", data: ticketData });
}

async function cancelServiceRequest(c: any, token: string) {
  const { serviceRequestId } = await c.req.json();

  if (!serviceRequestId) {
    return c.json({ error: "serviceRequestId is required" }, 400);
  }

  const response = await fetch(baseurl + "/api/ServiceRequests/cancelRequest", {
    method: "POST",
    headers: {
      authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ serviceRequestId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to cancel service request: ${response.statusText}`);
  }

  const data = await response.json();
  return c.json({ type: "CancelledServiceRequest", data: data });
}

// Product Inventory

app.get("/api/productInventory", async (c) => {
  const token = c.req.query("token");
  const operation = c.req.query("operation");

  if (!token) {
    return c.json({ error: "Token is required" }, 400);
  }

  if (!operation) {
    return c.json({ error: "Operation is required" }, 400);
  }

  try {
    switch (operation) {
      case "getActiveProductList":
        return await getActiveProductList(c, token);
      case "showActiveProducts":
        return await showActiveProducts(c, token);
      default:
        return c.json({ error: "Invalid operation" }, 400);
    }
  } catch (error) {
    console.error("Request failed:", error.message);
    return c.json({ error: "Request failed", details: error.message }, 500);
  }
});

async function getActiveProductList(c: any, token: string) {
  const response = await fetch(baseurl + "/api/Dashboards/activeProductList", {
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-GB,en;q=0.9",
      authorization: token,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch active product list: ${response.statusText}`
    );
  }

  const data = await response.json();
  return c.json({ type: "ActiveProductList", data: data });
}

async function showActiveProducts(c: any, token: string) {
  // This function will use the same endpoint as getActiveProductList,
  // but will format the data differently for display purposes
  const response = await fetch(baseurl + "/api/Dashboards/activeProductList", {
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-GB,en;q=0.9",
      authorization: token,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch active products: ${response.statusText}`);
  }

  const data = await response.json();

  // Format the data for display
  const formattedData = data.map((product: any) => ({
    id: product.id,
    name: product.productName,
    category: product.category,
    rentAmount: product.rentAmount,
    tenure: product.tenure,
    status: product.status,
  }));

  return c.json({
    type: "FormattedActiveProducts",
    data: formattedData,
    message: "These are your active rented products.",
    instruction: "Swipe or scroll to view all your active products.",
  });
}

export default app;
