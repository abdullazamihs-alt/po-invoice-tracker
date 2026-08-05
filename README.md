from http.server import BaseHTTPRequestHandler
import json
import os
import io
from datetime import datetime
import openpyxl

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "..", "templates", "po_template.xlsx")

# The printable "PO Print" tab in this template has room for 6 item rows
# (matching the original layout exactly). All items beyond that are still
# saved in the "Entry" tab of the same file (which supports far more rows),
# so no data is lost -- only the pretty printable page is capped at 6.
MAX_PRINT_ROWS = 6


def parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except Exception:
        return value


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body or b"{}")

            wb = openpyxl.load_workbook(TEMPLATE_PATH)
            entry = wb["Entry"]
            po_print = wb["PO Print"]

            po_number = (data.get("poNumber") or "").strip()
            supplier = (data.get("supplier") or "").strip()
            gst_pct = float(data.get("gstPercent", 8) or 8)
            gst_excluded = bool(data.get("gstExcluded", False))
            items = data.get("items", []) or []

            # --- Entry sheet (drives the header fields on PO Print via formulas) ---
            entry["B1"] = data.get("tin") or None
            entry["B2"] = supplier
            entry["B3"] = po_number
            entry["B4"] = parse_date(data.get("deliveryDate") or data.get("date"))
            entry["B5"] = data.get("deliveryTime") or None
            entry["B6"] = data.get("deliveryLocation") or None
            entry["B7"] = data.get("contactNumber") or None
            entry["B8"] = data.get("quotationNumber") or None
            entry["B9"] = gst_excluded
            entry["B10"] = gst_pct

            # Entry sheet item rows (this tab has formula-driven Sub Total / Gst / Total
            # already built in down to row 100, so all items are recorded here regardless
            # of how many there are)
            for idx, item in enumerate(items[:88]):
                r = 13 + idx
                entry[f"A{r}"] = item.get("description", "")
                entry[f"B{r}"] = item.get("unit") or ""
                entry[f"C{r}"] = item.get("qty") or 0
                entry[f"D{r}"] = item.get("unit_price") or 0
                entry[f"F{r}"] = item.get("resortRef") or po_number
                entry[f"G{r}"] = "N" if gst_excluded else "Y"

            # --- PO Print sheet: not formula-linked for header/items, so fill directly ---
            po_print["I9"] = data.get("paymentTerms") or None
            po_print["B10"] = data.get("attn") or None

            for idx, item in enumerate(items[:MAX_PRINT_ROWS]):
                r = 16 + idx
                qty = float(item.get("qty") or 0)
                rate = float(item.get("unit_price") or 0)
                sub = qty * rate
                gst_amt = 0 if gst_excluded else round(sub * gst_pct / 100, 2)
                total = sub + gst_amt
                po_print[f"A{r}"] = idx + 1
                po_print[f"B{r}"] = item.get("description", "")
                po_print[f"C{r}"] = item.get("unit") or ""
                po_print[f"D{r}"] = qty
                po_print[f"E{r}"] = rate
                po_print[f"F{r}"] = sub
                po_print[f"G{r}"] = gst_amt
                po_print[f"H{r}"] = total
                po_print[f"J{r}"] = item.get("resortRef") or po_number

            overflow = max(0, len(items) - MAX_PRINT_ROWS)

            buf = io.BytesIO()
            wb.save(buf)
            file_bytes = buf.getvalue()

            safe_name = (po_number or "order").replace("/", "-").replace(" ", "_")
            filename = f"PO_{safe_name}.xlsx"

            self.send_response(200)
            self.send_header(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("X-PO-Overflow-Items", str(overflow))
            self.send_header("Access-Control-Expose-Headers", "X-PO-Overflow-Items")
            self.send_header("Content-Length", str(len(file_bytes)))
            self.end_headers()
            self.wfile.write(file_bytes)
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode()
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
