import { AzureKeyCredential, DocumentAnalysisClient } from "@azure/ai-form-recognizer";
import { FormRecognizerFeature } from "@azure/ai-form-recognizer";
import type { DocumentKeyValuePair } from "@azure/ai-form-recognizer";
import { env } from "../config/env";
import type { DocumentCategory, DocumentKeyValue, InvoiceFields, ReceiptFields } from "../models/Document.model";

function mapKeyValuePairs(pairs: DocumentKeyValuePair[] | undefined): DocumentKeyValue[] {
  if (!pairs?.length) return [];
  const out: DocumentKeyValue[] = [];
  for (const pair of pairs) {
    const key = pair.key?.content?.trim() ?? "";
    const value = pair.value?.content?.trim() ?? "";
    if (key || value) {
      out.push({ key: key || "(field)", value });
    }
  }
  return out.slice(0, 200);
}

function summarizeTables(content: string): string {
  return content.length > 2000 ? `${content.slice(0, 2000)}…` : content;
}

export async function extractFromBuffer(
  buffer: Buffer,
  category: DocumentCategory,
): Promise<{
  text: string;
  keyValuePairs: DocumentKeyValue[];
  tablesPreview: string;
  finalCategory?: DocumentCategory;
  invoiceFields?: InvoiceFields;
  receiptFields?: ReceiptFields;
}> {
  if (!env.azureDocumentIntelligenceEndpoint || !env.azureDocumentIntelligenceKey) {
    throw new Error("Document Intelligence is not configured.");
  }

  const client = new DocumentAnalysisClient(
    env.azureDocumentIntelligenceEndpoint,
    new AzureKeyCredential(env.azureDocumentIntelligenceKey),
  );

  const getFieldValue = (field: unknown): string | number | undefined => {
    if (!field) return undefined;

    // Document Intelligence fields often come back as objects like:
    // { valueNumber }, { valueCurrency }, { valueDate }, or sometimes nested { value: ... }.
    // We must unwrap to a primitive to avoid "[object Object]".
    const f = field as any;

    const unwrapToPrimitive = (v: any): string | number | undefined => {
      if (v === undefined || v === null) return undefined;
      if (typeof v === "string" || typeof v === "number") return v;
      if (typeof v === "object") {
        if (typeof v.valueNumber === "number") return v.valueNumber;
        if (typeof v.valueString === "string") return v.valueString;
        if (typeof v.valueCurrency === "number") return v.valueCurrency;
        if (typeof v.valueDate === "string") return v.valueDate;
        if (typeof v.value === "number") return v.value;
        if (typeof v.value === "string") return v.value;
        // valueCurrency is commonly shaped like { value: number, unit, ... }
        if (v.valueCurrency && typeof v.valueCurrency.value === "number") return v.valueCurrency.value;
      }
      return undefined;
    };

    const candidates = [
      f.value,
      f.valueString,
      f.valueNumber,
      f.valueCurrency,
      f.valueDate,
      // Fallback: sometimes fields can be nested objects.
      typeof field === "string" ? field : undefined,
    ];

    for (const c of candidates) {
      const p = unwrapToPrimitive(c);
      if (p !== undefined) return p;
    }

    return undefined;
  };

  const parseItems = (
    itemsField: unknown,
  ): Array<{ description?: string; quantity?: number | string; unitPrice?: number | string; amount?: number | string }> | undefined => {
    const items = itemsField as { values?: Array<{ properties?: Record<string, unknown> }> } | undefined;
    const values = items?.values ?? [];
    if (!values.length) return undefined;
    const out: Array<{ description?: string; quantity?: number | string; unitPrice?: number | string; amount?: number | string }> = [];

    for (const v of values.slice(0, 200)) {
      const props = v.properties ?? (v as unknown as Record<string, unknown>);
      const description = getFieldValue(props["Description"] ?? props["ItemDescription"] ?? props["ProductName"]);
      const quantity = getFieldValue(props["Quantity"] ?? props["Qty"] ?? props["Count"]);
      const unitPrice = getFieldValue(props["UnitPrice"] ?? props["UnitPriceAmount"]);
      const amount = getFieldValue(props["Amount"] ?? props["LineAmount"] ?? props["TotalPrice"] ?? props["Price"]);
      out.push({ description: description ? String(description) : undefined, quantity, unitPrice, amount });
    }

    return out.length ? out : undefined;
  };

  const buildLayoutResult = async (): Promise<{
    text: string;
    keyValuePairs: DocumentKeyValue[];
    tablesPreview: string;
  }> => {
    let poller;
    try {
      poller = await client.beginAnalyzeDocument("prebuilt-layout", buffer, {
        features: [FormRecognizerFeature.KeyValuePairs],
      });
    } catch (error) {
      const e = error as Error & { code?: string; statusCode?: number };
      // Some Document Intelligence resources reject KeyValuePairs on layout with 400 InvalidArgument.
      // Retry without optional features so OCR/table extraction still succeeds.
      if (e.code === "InvalidArgument" || e.statusCode === 400) {
        poller = await client.beginAnalyzeDocument("prebuilt-layout", buffer);
      } else {
        throw error;
      }
    }

    const result = await poller.pollUntilDone();

    const text = result.content ?? "";
    const keyValuePairs = mapKeyValuePairs(result.keyValuePairs);

    let tablesPreview = "";
    if (result.tables?.length) {
      const lines: string[] = [];
      for (const table of result.tables.slice(0, 5)) {
        const rowCount = table.rowCount;
        const colCount = table.columnCount;
        lines.push(`Table ${table.rowCount}x${colCount}`);
        for (let r = 0; r < Math.min(rowCount, 8); r++) {
          const cells = table.cells
            .filter((c) => c.rowIndex === r)
            .sort((a, b) => a.columnIndex - b.columnIndex)
            .map((c) => c.content.trim())
            .join(" | ");
          if (cells) lines.push(cells);
        }
      }
      tablesPreview = summarizeTables(lines.join("\n"));
    }

    return { text, keyValuePairs, tablesPreview };
  };

  // Invoice/receipt: when using `prebuilt-invoice`, the strongly-typed fields live under `result.documents[0].fields`.
  const runPrebuiltInvoice = async (): Promise<{ text: string; invoiceFields: InvoiceFields }> => {
    const poller = await client.beginAnalyzeDocument("prebuilt-invoice", buffer);
    const result = await poller.pollUntilDone();
    const doc = (result as any)?.documents?.[0];
    const fields = doc?.fields ?? {};

    const invoiceFields: InvoiceFields = {
      invoiceNumber: getFieldValue(fields["InvoiceId"] ?? fields["InvoiceNumber"])?.toString(),
      vendorName: getFieldValue(fields["VendorName"] ?? fields["Vendor"])?.toString(),
      invoiceDate: getFieldValue(fields["InvoiceDate"] ?? fields["IssueDate"])?.toString(),
      dueDate: getFieldValue(fields["DueDate"] ?? fields["PaymentDueDate"])?.toString(),
      currency: getFieldValue(fields["TransactionCurrency"] ?? fields["Currency"])?.toString(),
      subtotal: getFieldValue(fields["Subtotal"] ?? fields["InvoiceSubtotal"]),
      tax: getFieldValue(fields["Tax"] ?? fields["GST"]),
      total: getFieldValue(fields["InvoiceTotal"] ?? fields["Total"]),
      lineItems: parseItems(fields["Items"]),
    };

    const text = String((result as any)?.content ?? doc?.content ?? invoiceFields.invoiceNumber ?? "");
    return { text, invoiceFields };
  };

  const runPrebuiltReceipt = async (): Promise<{ text: string; receiptFields: ReceiptFields }> => {
    const poller = await client.beginAnalyzeDocument("prebuilt-receipt", buffer);
    const result = await poller.pollUntilDone();
    const doc = (result as any)?.documents?.[0];
    const fields = doc?.fields ?? {};

    const receiptFields: ReceiptFields = {
      merchantName: getFieldValue(fields["MerchantName"] ?? fields["Merchant"])?.toString(),
      receiptNumber: getFieldValue(fields["ReceiptId"] ?? fields["ReceiptNumber"])?.toString(),
      transactionDate: getFieldValue(fields["TransactionDate"] ?? fields["ReceiptDate"])?.toString(),
      currency: getFieldValue(fields["Currency"] ?? fields["TransactionCurrency"])?.toString(),
      subtotal: getFieldValue(fields["Subtotal"]),
      tax: getFieldValue(fields["Tax"] ?? fields["VAT"]),
      total: getFieldValue(fields["Total"]),
      lineItems: parseItems(fields["Items"]),
    };

    const text = String(
      (result as any)?.content ??
        doc?.content ??
        receiptFields.merchantName ??
        receiptFields.receiptNumber ??
        receiptFields.total ??
        "",
    );
    return { text, receiptFields };
  };

  // Routing:
  // - resume -> always prebuilt-layout (formerly Form Recognizer layout extraction)
  // - general -> prebuilt-layout
  // - invoice -> prebuilt-invoice, fallback to prebuilt-receipt
  const runByCategory = async (): Promise<{
    text: string;
    keyValuePairs: DocumentKeyValue[];
    tablesPreview: string;
    finalCategory?: DocumentCategory;
    invoiceFields?: InvoiceFields;
    receiptFields?: ReceiptFields;
  }> => {
    if (category === "resume") {
      const layout = await buildLayoutResult();
      return { ...layout, finalCategory: "resume" };
    }

    if (category === "invoice") {
      try {
        const invoice = await runPrebuiltInvoice();
        const hasMeaningfulInvoice =
          Boolean(invoice.invoiceFields.total) ||
          Boolean(invoice.invoiceFields.invoiceNumber) ||
          Boolean(invoice.invoiceFields.vendorName);

        if (hasMeaningfulInvoice) {
          return {
            text: invoice.text,
            keyValuePairs: [],
            tablesPreview: "",
            finalCategory: "invoice",
            invoiceFields: invoice.invoiceFields,
          };
        }
      } catch {
        // ignore and fallback to receipt
      }

      const receipt = await runPrebuiltReceipt();
      return {
        text: receipt.text,
        keyValuePairs: [],
        tablesPreview: "",
        finalCategory: "receipt",
        receiptFields: receipt.receiptFields,
      };
    }

    const layout = await buildLayoutResult();
    return { ...layout, finalCategory: category };
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return runByCategory();
}
