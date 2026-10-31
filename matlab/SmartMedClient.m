% =========================================================================
% SmartMedClient.m - Comprehensive MATLAB API Client for SmartMed AI Platform
% Enables MATLAB scripts & apps to call OCR, Telephony, Diabetes ML, and Chat
% =========================================================================

classdef SmartMedClient < handle
    properties
        BaseUrl = 'http://localhost:8100'
        WebOptions
    end

    methods
        function obj = SmartMedClient(baseUrl)
            if nargin >= 1 && ~isempty(baseUrl)
                obj.BaseUrl = baseUrl;
            end
            obj.WebOptions = weboptions(...
                'Timeout', 60, ...
                'ContentType', 'json', ...
                'MediaType', 'application/json', ...
                'HeaderFields', {'Accept', 'application/json'});
        end

        % ─── Health & Telemetry ──────────────────────────────────────────
        function status = checkHealth(obj)
            url = sprintf('%s/api/ai/health', obj.BaseUrl);
            try
                status = webread(url, obj.WebOptions);
                fprintf('[SmartMedClient] Backend is HEALTHY at %s\n', obj.BaseUrl);
            catch ME
                fprintf('[SmartMedClient] Backend health check failed: %s\n', ME.message);
                status = struct('status', 'offline', 'error', ME.message);
            end
        end

        function status = getFullStatus(obj)
            status = struct();
            status.backend = false;
            status.ocr = false;
            status.twilio = false;
            status.diabetes = false;
            status.frontend = false;

            try
                r = webread(sprintf('%s/api/ai/health', obj.BaseUrl), obj.WebOptions);
                status.backend = isfield(r, 'status') && (strcmp(r.status, 'ok') || strcmp(r.status, 'online'));
            catch
            end

            try
                r = webread(sprintf('%s/api/ocr/status', obj.BaseUrl), obj.WebOptions);
                status.ocr = isfield(r, 'status') && (strcmp(r.status, 'ready') || strcmp(r.status, 'ok'));
            catch
            end

            try
                r = webread(sprintf('%s/api/call/status', obj.BaseUrl), obj.WebOptions);
                status.twilio = isfield(r, 'status') && (strcmp(r.status, 'ok') || strcmp(r.status, 'online'));
            catch
            end

            try
                r = webread(sprintf('%s/api/clinical/diabetes-status', obj.BaseUrl), obj.WebOptions);
                status.diabetes = isfield(r, 'status') && (strcmp(r.status, 'ok') || strcmp(r.status, 'online'));
            catch
            end

            % Check frontend on 3000 or 80
            status.frontend = pingEndpoint('http://localhost:3000') || pingEndpoint('http://localhost:80');
        end

        % ─── MathWorks Diabetes Mellitus Model ────────────────────────────
        function res = predictDiabetes(obj, patientData)
            url = sprintf('%s/api/clinical/diabetes-predict', obj.BaseUrl);
            payload = struct();
            payload.glucose = getFieldOr(patientData, 'glucose', 110);
            payload.bmi = getFieldOr(patientData, 'bmi', 25.5);
            payload.age = getFieldOr(patientData, 'age', 50);
            payload.systolic_bp = getFieldOr(patientData, 'systolic_bp', 120);
            payload.diastolic_bp = getFieldOr(patientData, 'diastolic_bp', 80);
            payload.heart_rate = getFieldOr(patientData, 'heart_rate', 75);
            payload.creatinine = getFieldOr(patientData, 'creatinine', 1.0);
            payload.bun = getFieldOr(patientData, 'bun', 16.0);
            payload.patient_name = getFieldOr(patientData, 'patient_name', 'Patient');

            try
                res = webwrite(url, payload, obj.WebOptions);
            catch ME
                % Fallback to local MATLAB predictor if backend is unreachable
                warning('Backend request failed (%s). Evaluating with local MATLAB predictor.', ME.message);
                res = PredictDiabetes(payload);
            end
        end

        % ─── Prescription OCR Pipeline ───────────────────────────────────
        function res = processPrescription(obj, imagePath)
            if ~exist(imagePath, 'file')
                error('Prescription image file not found: %s', imagePath);
            end
            url = sprintf('%s/api/ocr/prescription', obj.BaseUrl);

            fid = fopen(imagePath, 'rb');
            bytes = fread(fid, Inf, 'uint8=>uint8');
            fclose(fid);

            b64 = char(matlab.net.base64encode(bytes));
            payload = struct('image_base64', b64);
            try
                res = webwrite(url, payload, obj.WebOptions);
            catch ME
                error('Prescription OCR processing error: %s', ME.message);
            end
        end

        % ─── Telephony: Interactive Voice Reminders ───────────────────────
        function res = triggerVoiceCall(obj, phone, medicine, dosage, patientName, preferredLang, mealRelation)
            url = sprintf('%s/api/call/trigger_now', obj.BaseUrl);
            payload = struct();
            payload.phone_number = phone;
            payload.medicine = medicine;
            if nargin >= 4 && ~isempty(dosage), payload.dosage = dosage; else, payload.dosage = '500mg'; end
            if nargin >= 5 && ~isempty(patientName), payload.patient_name = patientName; else, payload.patient_name = 'Patient'; end
            if nargin >= 6 && ~isempty(preferredLang), payload.preferred_language = preferredLang; else, payload.preferred_language = 'en'; end
            if nargin >= 7 && ~isempty(mealRelation), payload.meal_relation = mealRelation; else, payload.meal_relation = 'after'; end
            payload.reminder_id = sprintf('rem_%d', round(posixtime(datetime('now'))));
            payload.patient_id = 'matlab_patient_1';

            try
                res = webwrite(url, payload, obj.WebOptions);
            catch ME
                res = struct('success', false, 'error', ME.message);
            end
        end

        function res = triggerConfirmationCall(obj, callId, phone, patientName, medicine)
            url = sprintf('%s/api/call/confirmation/trigger_now', obj.BaseUrl);
            payload = struct();
            payload.call_id = callId;
            payload.phone_number = phone;
            payload.patient_name = patientName;
            payload.medicine = medicine;

            try
                res = webwrite(url, payload, obj.WebOptions);
            catch ME
                res = struct('success', false, 'error', ME.message);
            end
        end

        function res = getConfirmations(obj)
            url = sprintf('%s/api/call/confirmations', obj.BaseUrl);
            try
                res = webread(url, obj.WebOptions);
            catch ME
                res = struct('confirmations', [], 'count', 0, 'error', ME.message);
            end
        end

        % ─── Clinical Triage Chat ─────────────────────────────────────────
        function res = chat(obj, message, patientName, preferredLang)
            url = sprintf('%s/api/ai/chat', obj.BaseUrl);
            payload = struct();
            payload.message = message;
            if nargin >= 3 && ~isempty(patientName), payload.patientName = patientName; else, payload.patientName = 'Patient'; end
            if nargin >= 4 && ~isempty(preferredLang), payload.preferred_language = preferredLang; else, payload.preferred_language = 'en'; end
            payload.history = {};
            payload.medicinesContext = {};

            try
                res = webwrite(url, payload, obj.WebOptions);
            catch ME
                res = struct('response', sprintf('Error communicating with clinical AI: %s', ME.message));
            end
        end
    end
end

function val = getFieldOr(s, f, defaultVal)
    if isfield(s, f) && ~isempty(s.(f))
        val = s.(f);
    else
        val = defaultVal;
    end
end

function ok = pingEndpoint(url)
    try
        opt = weboptions('Timeout', 2);
        webread(url, opt);
        ok = true;
    catch
        ok = false;
    end
end
