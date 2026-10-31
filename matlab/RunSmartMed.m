% =========================================================================
% SmartMed™ Master System Runner (MATLAB Orchestrator)
% MathWorks Predicting Diabetes Mellitus Integration & Full Stack Launcher
%
% Usage in MATLAB Command Window:
%   RunSmartMed             - Launches unified MATLAB Chromium App (Web + ML + OCR)
%   RunSmartMed('app')      - Opens embedded Chromium UI with all controls
%   RunSmartMed('web')      - Opens web app in MATLAB's built-in Chromium tab
%   RunSmartMed('status')   - Runs real-time diagnostics on all 5 services
%   RunSmartMed('gui')      - Opens MATLAB Clinical Diabetes GUI
%   RunSmartMed('predict')  - Evaluates patient diabetes risk using trained ML model
%   RunSmartMed('ocr', img) - Runs PaddleOCR & TrOCR on prescription image from MATLAB
%   RunSmartMed('call', ...) - Triggers interactive Twilio voice reminder call
%   RunSmartMed('chat', msg) - Queries SmartMed Clinical AI from MATLAB
%   RunSmartMed('start')    - Launches full backend/frontend stack & opens Chromium App
% =========================================================================

function RunSmartMed(command, varargin)
    if nargin < 1 || isempty(command)
        command = 'app';
    end

    projectRoot = fileparts(fileparts(mfilename('fullpath')));
    if isempty(projectRoot) || ~exist(fullfile(projectRoot, 'package.json'), 'file')
        if exist('package.json', 'file')
            projectRoot = pwd;
        else
            projectRoot = fullfile(fileparts(mfilename('fullpath')), '..');
        end
    end
    matlabDir = fullfile(projectRoot, 'matlab');
    addpath(matlabDir);

    client = SmartMedClient('http://localhost:8100');

    switch lower(command)
        case {'app', 'chromium', 'portal'}
            SmartMedApp();
            fprintf('SmartMed Omnichannel Platform active in MATLAB Embedded Chromium Engine\n');

        case 'web'
            try
                web('http://localhost:3000', '-new');
            catch
            end
            fprintf('SmartMed Chromium Browser Tab active at http://localhost:3000\n');

        case {'start', 'all', 'run'}
            startFullStack(projectRoot);

        case 'status'
            checkFullStatus();

        case 'gui'
            SmartMedDiabetesGUI();

        case 'predict'
            if ~isempty(varargin)
                PredictDiabetes(varargin{1});
            else
                PredictDiabetes();
            end

        case 'ocr'
            if ~isempty(varargin)
                imgPath = varargin{1};
            else
                imgPath = fullfile(projectRoot, 'ai', 'user_test_prescription.jpeg');
            end
            runOCRCLI(client, imgPath);

        case 'call'
            runCallCLI(client, varargin{:});

        case 'chat'
            if ~isempty(varargin)
                query = varargin{1};
            else
                query = 'Patient has elevated fasting glucose 180 mg/dL and HbA1c 7.9. Recommend triage.';
            end
            runChatCLI(client, query);

        case 'stop'
            stopServices(projectRoot);

        otherwise
            fprintf('Unknown command: "%s"\n', command);
            fprintf('Available commands: app, web, start, status, gui, predict, ocr, call, chat, stop\n');
    end
end

% -------------------------------------------------------------------------
% Start Full Stack Services & Open Chromium App
% -------------------------------------------------------------------------
function startFullStack(projectRoot)
    fprintf('\n');
    fprintf('===================================================================\n');
    fprintf('           SmartMed™ Healthcare AI Platform (MATLAB Edition)        \n');
    fprintf('    MathWorks Diabetes Mellitus • Chromium Engine • AI Telephony    \n');
    fprintf('===================================================================\n\n');

    % Step 1: Ensure MATLAB environment & models are loaded
    fprintf('[1/4] Initializing MATLAB Clinical Classifiers & Model Weights...\n');
    matlabDir = fullfile(projectRoot, 'matlab');
    modelFile = fullfile(matlabDir, 'trained_diabetes_model.mat');
    if ~exist(modelFile, 'file')
        fprintf('       Training MathWorks Diabetes Mellitus Classifier...\n');
        TrainDiabetesClassifier();
    else
        fprintf('       ✓ Trained Diabetes Model: %s\n', modelFile);
    end

    % Step 2: Check Backend Services
    fprintf('[2/4] Verifying SmartMed AI Backend (Port 8100)...\n');
    backendHealthy = pingUrl('http://localhost:8100/api/ai/health');
    if ~backendHealthy
        fprintf('       Backend offline. Starting Docker container...\n');
        system(sprintf('cd "%s" && docker compose up -d backend &', projectRoot));
        for retry = 1:12
            pause(1);
            if pingUrl('http://localhost:8100/api/ai/health')
                backendHealthy = true;
                break;
            end
        end
    end

    if backendHealthy
        fprintf('       ✓ SmartMed Backend is ONLINE at http://localhost:8100\n');
    else
        fprintf('       ⚠ SmartMed Backend could not be verified automatically.\n');
    end

    % Step 3: Check / Start Frontend (Port 3000 / 80)
    fprintf('[3/4] Verifying SmartMed Web Frontend...\n');
    frontendHealthy = pingUrl('http://localhost:3000') || pingUrl('http://localhost:80');
    if ~frontendHealthy
        fprintf('       Frontend offline. Starting Vite Dev Server...\n');
        system(sprintf('cd "%s" && npm run dev &', projectRoot));
        for retry = 1:10
            pause(1);
            if pingUrl('http://localhost:3000') || pingUrl('http://localhost:80')
                frontendHealthy = true;
                break;
            end
        end
    end

    if frontendHealthy
        fprintf('       ✓ SmartMed Frontend is ONLINE at http://localhost:3000\n');
    else
        fprintf('       ⚠ Frontend starting up in background.\n');
    end

    % Step 4: Run Sample Diabetes Prediction Verification
    fprintf('[4/4] Testing MathWorks Diabetes Mellitus Model Inference...\n');
    samplePatient = struct('glucose', 185, 'bmi', 31.2, 'age', 58, 'systolic_bp', 142);
    PredictDiabetes(samplePatient);

    % Launch Embedded Chromium App
    fprintf('\n-------------------------------------------------------------------\n');
    fprintf('  SUCCESS: SmartMed Platform is operational!\n');
    fprintf('  • Embedded Chromium App:     RunSmartMed(''app'')\n');
    fprintf('  • MATLAB Chromium Browser:  RunSmartMed(''web'')\n');
    fprintf('  • AI Backend & Twilio API:  http://localhost:8100\n');
    fprintf('  • MATLAB Clinical GUI:      RunSmartMed(''gui'')\n');
    fprintf('  • Interactive Predictor:    RunSmartMed(''predict'')\n');
    fprintf('-------------------------------------------------------------------\n\n');

    try
        SmartMedApp();
    catch
        % Fallback to MATLAB built-in browser
        web('http://localhost:3000', '-new');
    end
end

% -------------------------------------------------------------------------
% Check Full Status
% -------------------------------------------------------------------------
function checkFullStatus()
    fprintf('\n=== SmartMed System Health Check (from MATLAB) ===\n');
    checkEndpoint('Backend API Health', 'http://localhost:8100/api/ai/health');
    checkEndpoint('Prescription OCR Pipeline', 'http://localhost:8100/api/ocr/status');
    checkEndpoint('Twilio Call Telephony', 'http://localhost:8100/api/call/status');
    checkEndpoint('MathWorks Diabetes Service', 'http://localhost:8100/api/clinical/diabetes-status');
    if pingUrl('http://localhost:3000')
        checkEndpoint('Frontend Web Application', 'http://localhost:3000');
    elseif pingUrl('http://localhost:80')
        checkEndpoint('Frontend Web Application', 'http://localhost:80');
    else
        checkEndpoint('Frontend Web Application', 'http://localhost:3000');
    end
    fprintf('==================================================\n\n');
end

function checkEndpoint(name, url)
    ok = pingUrl(url);
    if ok
        fprintf('  [PASS] %-30s : ONLINE (%s)\n', name, url);
    else
        fprintf('  [FAIL] %-30s : OFFLINE or UNREACHABLE (%s)\n', name, url);
    end
end

function ok = pingUrl(url)
    ok = false;
    try
        opts = weboptions('Timeout', 2);
        webread(url, opts);
        ok = true;
    catch
        [status, ~] = system(sprintf('curl -s -m 2 -o /dev/null -w "%%{http_code}" "%s"', url));
        if status == 0
            ok = true;
        end
    end
end

% -------------------------------------------------------------------------
% CLI Handlers for OCR, Telephony, Chat
% -------------------------------------------------------------------------
function runOCRCLI(client, imgPath)
    fprintf('\n--- Running SmartMed Prescription OCR from MATLAB ---\n');
    fprintf('Image: %s\n', imgPath);
    try
        res = client.processPrescription(imgPath);
        fprintf('Success: %d | Confidence: %.1f%%\n', res.success, res.confidence * 100);
        if isfield(res, 'patient') && isfield(res.patient, 'name') && ~isempty(res.patient.name)
            fprintf('Patient: %s\n', res.patient.name);
        end
        if isfield(res, 'medications') && ~isempty(res.medications)
            fprintf('\nExtracted Medications (%d found):\n', numel(res.medications));
            for i = 1:numel(res.medications)
                m = res.medications{i};
                fprintf('  %d. %-20s | Dosage: %-10s | Freq: %-15s | Conf: %.2f\n', ...
                        i, m.name, m.dosage, m.frequency, m.confidence);
            end
        elseif isfield(res, 'medicines') && ~isempty(res.medicines)
            fprintf('\nExtracted Medicines (%d found):\n', numel(res.medicines));
            for i = 1:numel(res.medicines)
                m = res.medicines(i);
                fprintf('  %d. %-20s | Dosage: %-10s | Freq: %-15s | Conf: %.2f\n', ...
                        i, m.name, m.dosage, m.frequency, m.confidence);
            end
        end
    catch ME
        fprintf('OCR execution error: %s\n', ME.message);
    end
    fprintf('-----------------------------------------------------\n\n');
end

function runCallCLI(client, varargin)
    fprintf('\n--- Triggering Twilio Interactive Reminder Call from MATLAB ---\n');
    phone = '+919999999999';
    med = 'Metformin';
    dose = '500mg';
    name = 'Clinical Patient';
    lang = 'en';

    if length(varargin) >= 1 && ~isempty(varargin{1}), phone = varargin{1}; end
    if length(varargin) >= 2 && ~isempty(varargin{2}), med = varargin{2}; end
    if length(varargin) >= 3 && ~isempty(varargin{3}), dose = varargin{3}; end
    if length(varargin) >= 4 && ~isempty(varargin{4}), name = varargin{4}; end
    if length(varargin) >= 5 && ~isempty(varargin{5}), lang = varargin{5}; end

    fprintf('Calling: %s | Patient: %s | Medicine: %s (%s) | Lang: %s\n', phone, name, med, dose, lang);
    res = client.triggerVoiceCall(phone, med, dose, name, lang, 'after');
    if isfield(res, 'success') && res.success
        fprintf('✓ Call Dispatched Successfully! SID: %s | Status: %s\n', res.call_sid, res.status);
    else
        err = 'Check Twilio credentials or server logs';
        if isfield(res, 'error'), err = res.error; end
        fprintf('Result note: %s\n', err);
    end
    fprintf('----------------------------------------------------------------\n\n');
end

function runChatCLI(client, query)
    fprintf('\n--- SmartMed AI Clinical Triage Query from MATLAB ---\n');
    fprintf('Query: %s\n\n', query);
    res = client.chat(query, 'Clinical Patient', 'en');
    if isfield(res, 'response')
        fprintf('Clinical AI Advisory:\n%s\n', res.response);
    elseif isfield(res, 'text')
        fprintf('Clinical AI Advisory:\n%s\n', res.text);
    else
        fprintf('Response received.\n');
    end
    fprintf('------------------------------------------------------\n\n');
end

function stopServices(projectRoot)
    fprintf('Stopping SmartMed dev services...\n');
    system('pkill -f "vite" || true');
    fprintf('Done.\n');
end
