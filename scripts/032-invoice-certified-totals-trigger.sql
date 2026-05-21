-- =============================================================================
-- STAGE 1: Add Invoice Certified Totals Trigger
-- =============================================================================
-- Ensures invoices.total_certified_cents stays in sync with payment_certificates
-- =============================================================================

CREATE OR REPLACE FUNCTION update_invoice_certified_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_invoice_id UUID;
    v_total_certified BIGINT;
BEGIN
    -- Determine the invoice ID based on the operation
    IF TG_OP = 'DELETE' THEN
        v_invoice_id := OLD.invoice_id;
    ELSE
        v_invoice_id := NEW.invoice_id;
    END IF;

    -- Calculate the sum of all non-rejected, non-cancelled certificates for this invoice
    SELECT COALESCE(SUM(certified_amount_cents), 0)
    INTO v_total_certified
    FROM payment_certificates
    WHERE invoice_id = v_invoice_id
      AND status NOT IN ('rejected', 'cancelled');

    -- Update the invoice
    UPDATE invoices
    SET total_certified_cents = v_total_certified
    WHERE id = v_invoice_id;

    RETURN NULL; -- AFTER trigger can return NULL
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_invoice_certified_totals ON payment_certificates;

CREATE TRIGGER trigger_update_invoice_certified_totals
AFTER INSERT OR UPDATE OF certified_amount_cents, status OR DELETE
ON payment_certificates
FOR EACH ROW
EXECUTE FUNCTION update_invoice_certified_totals();
