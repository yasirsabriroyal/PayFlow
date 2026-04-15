-- ============================================
-- Notification System Migration
-- Version: 002
-- Description: Add notification logs table and user preference columns
-- ============================================

-- ============================================
-- 1. Add notification preference columns to users table
-- ============================================

ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS whatsapp_notifications_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS notification_email CHARACTER VARYING(255),
ADD COLUMN IF NOT EXISTS notification_phone CHARACTER VARYING(50);

-- Set notification_email to match existing email if null
UPDATE public.users 
SET notification_email = email 
WHERE notification_email IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.users.email_notifications_enabled IS 'User preference to receive email notifications';
COMMENT ON COLUMN public.users.whatsapp_notifications_enabled IS 'User preference to receive WhatsApp notifications';
COMMENT ON COLUMN public.users.notification_email IS 'Email address for notifications (may differ from login email)';
COMMENT ON COLUMN public.users.notification_phone IS 'Phone number for WhatsApp notifications in E.164 format';

-- ============================================
-- 2. Create notification_logs table for audit trail
-- ============================================

-- Create notification type enum
DO $$ BEGIN
    CREATE TYPE notification_channel AS ENUM ('email', 'whatsapp', 'sms', 'push');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Create notification status enum
DO $$ BEGIN
    CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'delivered', 'failed', 'skipped');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Create notification event type enum
DO $$ BEGIN
    CREATE TYPE notification_event_type AS ENUM (
        'invoice_submitted',
        'invoice_approved', 
        'invoice_rejected',
        'payment_registered',
        'payment_paid',
        'payment_failed',
        'approval_required',
        'holdback_released',
        'kyc_verified',
        'kyc_rejected',
        'wcb_expiring',
        'general'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Create the notification_logs table
CREATE TABLE IF NOT EXISTS public.notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Event information
    event_type notification_event_type NOT NULL,
    event_description TEXT,
    
    -- Related entities (all optional, depends on event type)
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    payment_request_id UUID REFERENCES public.payment_requests(id) ON DELETE SET NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    contractor_id UUID REFERENCES public.contractors(id) ON DELETE SET NULL,
    
    -- Recipient information
    recipient_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    recipient_contractor_id UUID REFERENCES public.contractors(id) ON DELETE SET NULL,
    recipient_name CHARACTER VARYING(255) NOT NULL,
    recipient_email CHARACTER VARYING(255),
    recipient_phone CHARACTER VARYING(50),
    recipient_role CHARACTER VARYING(50),
    
    -- Notification channel and status
    channel notification_channel NOT NULL,
    status notification_status NOT NULL DEFAULT 'pending',
    
    -- Content
    subject CHARACTER VARYING(500),
    message_preview TEXT, -- First 500 chars of message body
    
    -- Delivery tracking
    external_message_id CHARACTER VARYING(255), -- ID from Resend/Twilio
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    error_code CHARACTER VARYING(50),
    
    -- User preference check
    user_preference_checked BOOLEAN DEFAULT false,
    skipped_reason TEXT, -- e.g., 'user_disabled_email', 'no_phone_number'
    
    -- Request/Response for debugging
    request_payload JSONB,
    response_payload JSONB,
    
    -- Retry tracking
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    triggered_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_notification_logs_event_type ON public.notification_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_notification_logs_channel ON public.notification_logs(channel);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON public.notification_logs(status);
CREATE INDEX IF NOT EXISTS idx_notification_logs_recipient_user ON public.notification_logs(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_recipient_contractor ON public.notification_logs(recipient_contractor_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_invoice ON public.notification_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_payment_request ON public.notification_logs(payment_request_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON public.notification_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_pending_retry ON public.notification_logs(status, next_retry_at) 
    WHERE status = 'pending' AND next_retry_at IS NOT NULL;

-- ============================================
-- 3. Enable RLS on notification_logs
-- ============================================

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- Admins and accountants can view all notification logs
CREATE POLICY "notification_logs_select_internal" ON public.notification_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.users u 
            WHERE u.auth_user_id = auth.uid() 
            AND u.role IN ('admin', 'accountant')
        )
    );

-- Users can view their own notifications
CREATE POLICY "notification_logs_select_own" ON public.notification_logs
    FOR SELECT
    USING (recipient_user_id = auth.uid());

-- Contractors can view notifications sent to them
CREATE POLICY "notification_logs_select_contractor" ON public.notification_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.contractors c 
            WHERE c.auth_user_id = auth.uid() 
            AND c.id = notification_logs.recipient_contractor_id
        )
    );

-- Allow system to insert (via service role or authenticated users for triggered notifications)
CREATE POLICY "notification_logs_insert" ON public.notification_logs
    FOR INSERT
    WITH CHECK (true);

-- Allow updates for retry/status tracking (internal system use)
CREATE POLICY "notification_logs_update" ON public.notification_logs
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.users u 
            WHERE u.auth_user_id = auth.uid() 
            AND u.role IN ('admin', 'accountant')
        )
    );

-- ============================================
-- 4. Create helper functions
-- ============================================

-- Function to check user notification preferences
CREATE OR REPLACE FUNCTION public.check_user_notification_preference(
    p_user_id UUID,
    p_channel notification_channel
)
RETURNS BOOLEAN AS $$
DECLARE
    v_enabled BOOLEAN;
BEGIN
    SELECT 
        CASE p_channel
            WHEN 'email' THEN email_notifications_enabled
            WHEN 'whatsapp' THEN whatsapp_notifications_enabled
            ELSE true
        END
    INTO v_enabled
    FROM public.users
    WHERE id = p_user_id OR auth_user_id = p_user_id;
    
    RETURN COALESCE(v_enabled, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get users by role for notification routing
CREATE OR REPLACE FUNCTION public.get_users_by_role(p_role user_role)
RETURNS TABLE (
    id UUID,
    email CHARACTER VARYING,
    phone CHARACTER VARYING,
    first_name CHARACTER VARYING,
    last_name CHARACTER VARYING,
    notification_email CHARACTER VARYING,
    notification_phone CHARACTER VARYING,
    email_notifications_enabled BOOLEAN,
    whatsapp_notifications_enabled BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.email,
        u.phone,
        u.first_name,
        u.last_name,
        u.notification_email,
        u.notification_phone,
        u.email_notifications_enabled,
        u.whatsapp_notifications_enabled
    FROM public.users u
    WHERE u.role = p_role
    AND u.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log a notification attempt
CREATE OR REPLACE FUNCTION public.log_notification(
    p_event_type notification_event_type,
    p_channel notification_channel,
    p_recipient_name TEXT,
    p_recipient_email TEXT DEFAULT NULL,
    p_recipient_phone TEXT DEFAULT NULL,
    p_recipient_user_id UUID DEFAULT NULL,
    p_recipient_contractor_id UUID DEFAULT NULL,
    p_recipient_role TEXT DEFAULT NULL,
    p_subject TEXT DEFAULT NULL,
    p_message_preview TEXT DEFAULT NULL,
    p_invoice_id UUID DEFAULT NULL,
    p_payment_request_id UUID DEFAULT NULL,
    p_project_id UUID DEFAULT NULL,
    p_contractor_id UUID DEFAULT NULL,
    p_status notification_status DEFAULT 'pending',
    p_triggered_by UUID DEFAULT NULL,
    p_request_payload JSONB DEFAULT NULL,
    p_skipped_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO public.notification_logs (
        event_type,
        channel,
        recipient_name,
        recipient_email,
        recipient_phone,
        recipient_user_id,
        recipient_contractor_id,
        recipient_role,
        subject,
        message_preview,
        invoice_id,
        payment_request_id,
        project_id,
        contractor_id,
        status,
        triggered_by,
        request_payload,
        skipped_reason,
        user_preference_checked,
        sent_at
    ) VALUES (
        p_event_type,
        p_channel,
        p_recipient_name,
        p_recipient_email,
        p_recipient_phone,
        p_recipient_user_id,
        p_recipient_contractor_id,
        p_recipient_role,
        p_subject,
        LEFT(p_message_preview, 500),
        p_invoice_id,
        p_payment_request_id,
        p_project_id,
        p_contractor_id,
        p_status,
        p_triggered_by,
        p_request_payload,
        p_skipped_reason,
        CASE WHEN p_skipped_reason IS NOT NULL THEN true ELSE false END,
        CASE WHEN p_status = 'sent' THEN NOW() ELSE NULL END
    )
    RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update notification status
CREATE OR REPLACE FUNCTION public.update_notification_status(
    p_log_id UUID,
    p_status notification_status,
    p_external_message_id TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_error_code TEXT DEFAULT NULL,
    p_response_payload JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.notification_logs
    SET 
        status = p_status,
        external_message_id = COALESCE(p_external_message_id, external_message_id),
        error_message = p_error_message,
        error_code = p_error_code,
        response_payload = p_response_payload,
        sent_at = CASE WHEN p_status = 'sent' THEN NOW() ELSE sent_at END,
        delivered_at = CASE WHEN p_status = 'delivered' THEN NOW() ELSE delivered_at END,
        failed_at = CASE WHEN p_status = 'failed' THEN NOW() ELSE failed_at END,
        retry_count = CASE WHEN p_status = 'failed' THEN retry_count + 1 ELSE retry_count END,
        next_retry_at = CASE 
            WHEN p_status = 'failed' AND retry_count < max_retries 
            THEN NOW() + (POWER(2, retry_count) * INTERVAL '1 minute')
            ELSE NULL 
        END,
        updated_at = NOW()
    WHERE id = p_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. Create view for notification statistics
-- ============================================

CREATE OR REPLACE VIEW public.v_notification_stats AS
SELECT 
    DATE_TRUNC('day', created_at) AS date,
    event_type,
    channel,
    status,
    COUNT(*) AS count,
    COUNT(*) FILTER (WHERE status = 'sent') AS sent_count,
    COUNT(*) FILTER (WHERE status = 'delivered') AS delivered_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
    COUNT(*) FILTER (WHERE status = 'skipped') AS skipped_count
FROM public.notification_logs
GROUP BY DATE_TRUNC('day', created_at), event_type, channel, status
ORDER BY date DESC;

-- ============================================
-- 6. Update trigger for updated_at
-- ============================================

CREATE OR REPLACE FUNCTION public.update_notification_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notification_logs_updated_at ON public.notification_logs;
CREATE TRIGGER trigger_notification_logs_updated_at
    BEFORE UPDATE ON public.notification_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_notification_logs_updated_at();

-- ============================================
-- 7. Grant permissions
-- ============================================

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION public.check_user_notification_preference TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_users_by_role TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_notification TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_notification_status TO authenticated;

-- Grant select on view
GRANT SELECT ON public.v_notification_stats TO authenticated;

-- ============================================
-- Migration complete
-- ============================================

COMMENT ON TABLE public.notification_logs IS 'Audit trail for all notification attempts (email, WhatsApp, SMS, push)';
