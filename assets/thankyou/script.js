const receiptData = JSON.parse(localStorage.getItem("kioskReceipt"));
const orderType = localStorage.getItem("orderType");

// Get the current URL parameters
const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get("token");

(async () => {
    // Check if receiptData exists and contains tokenId
    if (!receiptData || receiptData.tokenId == null) {
        window.location.href = `access-denied.html`;
        return;
    }
    // Only compare if the URL actually carries a token (serve may strip query string on .html redirect)
    if (urlToken !== null && String(urlToken) !== String(receiptData.tokenId)) {
        window.location.href = `access-denied.html`;
    }
})();

async function renderAndPrint() {
    if (!receiptData || !receiptData.items) {
        document.body.innerHTML = "<p style='text-align:center'>No receipt data found.</p>";
        return;
    }

    const token = receiptData.tokenId || "000";

    // ✅ Prevent re-downloading for same token
    const printedFlagKey = `printed_${token}`;
    if (localStorage.getItem(printedFlagKey) === "true") {
        console.log("🛑 PDF already downloaded for token:", token);
        return;
    }

    const formatted = new Date().toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    $("#branch-name").text(receiptData.branch_name || "POS");
    $("#orderDate").text(formatted);
    $("#orderTime").text(formatted);
    $("#token-id").text(token);
    $("#tokenId").text(token);
    $("#orderId").text(token);

    const itemsContainer = document.getElementById("items");

    // if container not found, stop to avoid error
    if (!itemsContainer) {
        //console.error("items container not found on this page");
        return;
    }

    itemsContainer.innerHTML = `
        <div class="item header-row">        
            <div class="item-name" translate="no">Item Name</div>
            <div class="item-qty">Qty</div>
            <div class="item-amt">Amount</div>
        </div>
    `;

    receiptData.items.forEach(item => {
        const row = document.createElement("div");
        row.className = "item";

        const qty = item.item_quantity || 1;
        const totalTax = item.item_tax || 0;

        let discount = 0;
        if (item.item_discount && item.item_discount > 0) {
            discount = item.item_discount;
        } else if (item.item_discount_percentage && item.item_discount_percentage > 0) {
            discount = item.item_discount_percentage;
        }

        const itemTax = totalTax / qty;
        const itemDisc = discount / qty;
        const totalLine = `${CaptainMoney.display(item.item_total)}`;

        const subInfoParts = [];
        subInfoParts.push(`${CaptainMoney.display(item.item_base_price)}`);
        if (itemTax > 0) subInfoParts.push(`${CaptainMoney.display(itemTax)} tax`);
        if (itemDisc > 0) subInfoParts.push(`-${CaptainMoney.display(itemDisc)} disc`);

        row.innerHTML = `
            <div class="item-name" translate="no">
                ${item.item_name}
                ${subInfoParts.length ? `<div class="sub-info">${subInfoParts.join(" | ")}</div>` : ""}
            </div>
            <div class="item-qty">${qty}</div>
            <div class="item-amt">${totalLine}</div>
        `;
        itemsContainer.appendChild(row);
    });

    $("#subtotal").text(`${CaptainMoney.display(receiptData.subtotal)}`);
    $("#discount").text(`-${CaptainMoney.display(receiptData.discount)}`);
    $("#tax").text(`${CaptainMoney.display(receiptData.tax)}`);
    $("#total").text(`${CaptainMoney.display(receiptData.total)}`);
    $("#orderTypePrint").text(orderType);

    // ✅ Generate PDF after 1s
    // setTimeout(async () => {
    //     await generatePdfFromHtmlFile();
    //     localStorage.setItem(printedFlagKey, "true"); // ✅ Mark as printed
    // }, 1000);
}


async function generatePdfFromHtmlFile() {

    // 1. Fetch the HTML file content
    const response = await fetch('receipt.html');
    const htmlContent = await response.text();

    const parser = new DOMParser();
    const externalDoc = parser.parseFromString(htmlContent, 'text/html');
    const $externalDoc = $(externalDoc);

    // Use jQuery to find and update the elements
    $externalDoc.find('#branchName').text(receiptData.branch_name);
    $externalDoc.find('#orderToken').text(receiptData.tokenId);
    $externalDoc.find('#orderDate').text(new Date().toLocaleString());
    $externalDoc.find('#orderTypePrint').text(orderType);
    $externalDoc.find('#subtotal').text(CaptainMoney.display(receiptData.subtotal));
    $externalDoc.find('#discount').text("-" + CaptainMoney.display(receiptData.discount));
    $externalDoc.find('#tax').text(CaptainMoney.display(receiptData.tax));
    $externalDoc.find('#total').text(CaptainMoney.display(receiptData.total));

    const $itemsBody = $externalDoc.find('#items-body');

    // Add item rows
    receiptData.items.forEach(item => {
        const totalTax = item.item_tax || 0;
        let discount = 0;
        if (item.item_discount && item.item_discount > 0) {
            discount = item.item_discount;
        } else if (item.item_discount_percentage && item.item_discount_percentage > 0) {
            discount = item.item_discount_percentage;
        }
        const total = item.item_total * item.item_quantity;
        const quantity = item.item_quantity || 0;
        const itemTax = totalTax / quantity;
        const itemDisc = discount / quantity;
        const $tr = $(`
        <tr>
            <td>${item.item_name}</td>
            <td class="right">${CaptainMoney.display(item.item_base_price)}</td>
            <td class="right">${CaptainMoney.display(itemTax)}</td>
            <td class="right">-${CaptainMoney.display(itemDisc)}</td>
            <td class="right">${quantity}</td>            
            <td class="right">${CaptainMoney.display(item.item_total)}</td>
        </tr>
    `);
        $itemsBody.append($tr);
    });

    // Total items and total quantity
    if (receiptData.items) {
        $externalDoc.find('#totalItems').text(receiptData.items.length);
        const totalQty = receiptData.items.reduce((sum, item) => sum + item.item_quantity, 0);
        $externalDoc.find('#totalQty').text(totalQty);
    }

    const updatedHtml = externalDoc.documentElement.outerHTML;

    // 2. Create a temporary element to hold the content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = updatedHtml;
    // tempDiv.style.display = 'none';
    document.body.appendChild(tempDiv);

    // 3. PDF options
    const opt = {
        margin: 10,
        filename: 'receipt.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
    };

    // 4. Generate and download PDF
    await html2pdf().set(opt).from(tempDiv).save();

    // ✅ Step 1: Set the printed flag
    localStorage.setItem("kioskReceiptPrinted", "true");

    // 5. Clean up
    document.body.removeChild(tempDiv);
}

document.addEventListener("DOMContentLoaded", renderAndPrint);
function clearReceiptAndGo(url) {
    localStorage.removeItem("kioskReceiptPrinted");
    localStorage.removeItem("kioskReceipt");
    window.location.href = url;
}