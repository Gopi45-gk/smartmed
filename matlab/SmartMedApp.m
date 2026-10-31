% =========================================================================
% SmartMedApp.m - Full-Stack Omnichannel SmartMed Platform in MATLAB
% Renders the SmartMed Web App via MATLAB Chromium Engine alongside
% MathWorks Diabetes Mellitus Classifier, Prescription OCR, & Telephony.
% =========================================================================

function fig = SmartMedApp()
    warning('off', 'MATLAB:ui:uihtml:ErrorOccuredInHTMLSource');
    currentDir = fileparts(mfilename('fullpath'));
    addpath(currentDir);

    % Close any existing instance to ensure fresh render
    existingFig = findall(0, 'Type', 'figure', 'Name', 'SmartMed AI Platform (MATLAB Chromium Engine)');
    if ~isempty(existingFig)
        delete(existingFig);
    end

    client = SmartMedClient('http://localhost:8100');

    % 1. Create Main Window
    screenSize = get(0, 'ScreenSize');
    winWidth = min(1400, screenSize(3) - 60);
    winHeight = min(900, screenSize(4) - 80);
    winLeft = max(30, round((screenSize(3) - winWidth) / 2));
    winBottom = max(30, round((screenSize(4) - winHeight) / 2));

    fig = uifigure('Name', 'SmartMed AI Platform (MATLAB Chromium Engine)', ...
                   'Position', [winLeft winBottom winWidth winHeight], ...
                   'Color', [0.08 0.11 0.17]);

    % 2. Top Navigation Ribbon
    topRibbon = uipanel(fig, 'Position', [0 winHeight-55 winWidth 55], ...
                        'BackgroundColor', [0.12 0.16 0.24], ...
                        'BorderType', 'none');

    uilabel(topRibbon, 'Text', 'SmartMed Platform', ...
            'FontSize', 16, 'FontWeight', 'bold', ...
            'FontColor', [0.22 0.74 0.97], ...
            'Position', [16 26 220 22]);

    uilabel(topRibbon, 'Text', 'MATLAB Chromium Engine • MathWorks Diabetes ML • Prescription OCR • Twilio Telephony', ...
            'FontSize', 10, ...
            'FontColor', [0.58 0.64 0.72], ...
            'Position', [16 8 550 16]);

    % Status Badge
    lblStatus = uilabel(topRibbon, 'Text', '● CHECKING SERVICES...', ...
                        'FontSize', 11, 'FontWeight', 'bold', ...
                        'FontColor', [0.95 0.77 0.25], ...
                        'HorizontalAlignment', 'right', ...
                        'Position', [winWidth-560 18 200 20]);

    % Top Action Buttons
    btnPopout = uibutton(topRibbon, 'Text', '🌐 Launch Chromium Tab', ...
                         'Position', [winWidth-350 12 170 32], ...
                         'BackgroundColor', [0.01 0.52 0.78], ...
                         'FontColor', [1 1 1], ...
                         'FontWeight', 'bold', ...
                         'ButtonPushedFcn', @(~,~) web('http://localhost:3000', '-new'));

    btnCheck = uibutton(topRibbon, 'Text', '⚡ Health', ...
                        'Position', [winWidth-170 12 70 32], ...
                        'BackgroundColor', [0.2 0.25 0.35], ...
                        'FontColor', [1 1 1], ...
                        'ButtonPushedFcn', @(~,~) refreshHealthStatus());

    btnReload = uibutton(topRibbon, 'Text', '↻', ...
                         'Position', [winWidth-90 12 45 32], ...
                         'BackgroundColor', [0.2 0.25 0.35], ...
                         'FontColor', [1 1 1], ...
                         'FontSize', 14, ...
                         'ButtonPushedFcn', @(~,~) refreshHealthStatus());

    % 3. Tab Group for All Platform Subsystems
    tabGroup = uitabgroup(fig, 'Position', [0 0 winWidth winHeight-55]);

    % ─── TAB 1: SmartMed Chromium Portal Hub ──────────────────────────────
    tabChromium = uitab(tabGroup, 'Title', '  🖥  SmartMed Web App (Chromium)  ');
    tabChromium.BackgroundColor = [0.08 0.11 0.17];
    buildChromiumPortalTab(tabChromium, client, tabGroup);

    % ─── TAB 2: MathWorks Diabetes Intelligence ───────────────────────────
    tabDiabetes = uitab(tabGroup, 'Title', '  🩺  MathWorks Diabetes ML Model  ');
    tabDiabetes.BackgroundColor = [0.96 0.97 0.98];
    buildDiabetesTab(tabDiabetes, client);

    % ─── TAB 3: Prescription OCR Studio ───────────────────────────────────
    tabOCR = uitab(tabGroup, 'Title', '  📷  Prescription OCR (PaddleOCR/TrOCR)  ');
    tabOCR.BackgroundColor = [0.96 0.97 0.98];
    buildOCRTab(tabOCR, client);

    % ─── TAB 4: Twilio Interactive Voice Telephony ────────────────────────
    tabTelephony = uitab(tabGroup, 'Title', '  📞  Twilio Telephony Engine  ');
    tabTelephony.BackgroundColor = [0.96 0.97 0.98];
    buildTelephonyTab(tabTelephony, client);

    % ─── TAB 5: Clinical AI Medical Triage ────────────────────────────────
    tabTriage = uitab(tabGroup, 'Title', '  💬  Clinical AI Triage & Advisory  ');
    tabTriage.BackgroundColor = [0.96 0.97 0.98];
    buildTriageTab(tabTriage, client);

    % Initial Health Check
    refreshHealthStatus();

    % ---------------------------------------------------------------------
    % Nested Callbacks
    % ---------------------------------------------------------------------
    function refreshHealthStatus()
        lblStatus.Text = '● CHECKING...';
        drawnow;
        st = client.getFullStatus();
        allOnline = st.backend && st.diabetes && st.frontend;
        if allOnline
            lblStatus.Text = '● ALL SERVICES ONLINE';
            lblStatus.FontColor = [0.1 0.78 0.45];
        else
            lblStatus.Text = '▲ SOME SERVICES RESTARTING';
            lblStatus.FontColor = [0.95 0.55 0.2];
        end
    end
end

% =========================================================================
% Build SmartMed Chromium Portal Tab
% =========================================================================
function buildChromiumPortalTab(parent, client, tabGroup)
    tabPos = parent.Position;
    w = max(1000, tabPos(3));
    h = max(700, tabPos(4));
    toolbarHeight = 44;

    % 1. Control Toolbar at the Top
    pnlBar = uipanel(parent, 'Position', [0 h-toolbarHeight w toolbarHeight], ...
                     'BackgroundColor', [0.10 0.14 0.22], ...
                     'BorderType', 'none');

    % Status Dot & Badge
    uilabel(pnlBar, 'Text', '● LIVE EMBEDDED CHROMIUM', ...
            'FontSize', 11, 'FontWeight', 'bold', ...
            'FontColor', [0.1 0.78 0.45], ...
            'Position', [16 12 210 20]);

    % Address indicator
    uilabel(pnlBar, 'Text', 'SmartMed Omnichannel Web App (http://localhost:3000)', ...
            'FontSize', 11, ...
            'FontColor', [0.65 0.75 0.88], ...
            'Position', [230 12 400 20]);

    % Action Buttons
    btnReload = uibutton(pnlBar, 'Text', '↻ Reload App', ...
                         'Position', [w-360 7 105 30], ...
                         'BackgroundColor', [0.18 0.23 0.33], ...
                         'FontColor', [1 1 1], ...
                         'FontWeight', 'bold', ...
                         'ButtonPushedFcn', @(~,~) reloadApp());

    btnTab = uibutton(pnlBar, 'Text', '🌐 Popout Tab', ...
                      'Position', [w-245 7 110 30], ...
                      'BackgroundColor', [0.01 0.52 0.78], ...
                      'FontColor', [1 1 1], ...
                      'FontWeight', 'bold', ...
                      'ButtonPushedFcn', @(~,~) web('http://localhost:3000', '-new'));

    btnExt = uibutton(pnlBar, 'Text', 'External ↗', ...
                      'Position', [w-125 7 105 30], ...
                      'BackgroundColor', [0.18 0.23 0.33], ...
                      'FontColor', [0.85 0.92 1], ...
                      'ButtonPushedFcn', @(~,~) web('http://localhost:3000', '-browser'));

    % 2. Live Chromium Web View via uihtml
    matlabDir = fileparts(mfilename('fullpath'));
    htmlFile = fullfile(matlabDir, 'embedded_app.html');

    htmlView = uihtml(parent, 'Position', [0 0 w h-toolbarHeight]);
    htmlView.HTMLSource = htmlFile;

    % Responsive resize handler
    parent.AutoResizeChildren = 'off';
    parent.SizeChangedFcn = @(src, ~) onTabResize(src);

    function reloadApp()
        htmlView.HTMLSource = '';
        drawnow;
        htmlView.HTMLSource = htmlFile;
    end

    function onTabResize(tab)
        sz = tab.Position;
        tw = sz(3);
        th = sz(4);
        pnlBar.Position = [0 th-toolbarHeight tw toolbarHeight];
        btnReload.Position = [tw-360 7 105 30];
        btnTab.Position = [tw-245 7 110 30];
        btnExt.Position = [tw-125 7 105 30];
        htmlView.Position = [0 0 tw th-toolbarHeight];
    end
end

% =========================================================================
% Build MathWorks Diabetes Tab
% =========================================================================
function buildDiabetesTab(parent, client)
    pnlInput = uipanel(parent, 'Title', 'Patient Vitals & Clinical Laboratory Data', ...
                       'Position', [20 20 480 760], 'FontSize', 12, 'FontWeight', 'bold');

    % Presets
    uilabel(pnlInput, 'Text', 'Clinical Patient Presets:', 'Position', [20 700 160 20], 'FontWeight', 'bold');
    btnNormal = uibutton(pnlInput, 'Text', 'Normal Patient', 'Position', [180 697 90 26]);
    btnBorder = uibutton(pnlInput, 'Text', 'Borderline', 'Position', [275 697 85 26]);
    btnHigh = uibutton(pnlInput, 'Text', 'High Risk ICU', 'Position', [365 697 95 26]);

    fields = {
        'Glucose (mg/dL):', 185, 40, 400;
        'BMI (kg/m²):', 31.2, 10, 60;
        'Age (years):', 58, 1, 110;
        'Systolic BP (mmHg):', 142, 60, 250;
        'Diastolic BP (mmHg):', 88, 40, 150;
        'Heart Rate (bpm):', 84, 40, 200;
        'Serum Creatinine (mg/dL):', 1.3, 0.2, 10.0;
        'Blood Urea Nitrogen (BUN):', 24, 2, 80
    };

    numInputs = containers.Map();
    yPos = 650;
    for i = 1:size(fields, 1)
        name = fields{i, 1};
        defVal = fields{i, 2};
        minVal = fields{i, 3};
        maxVal = fields{i, 4};

        uilabel(pnlInput, 'Text', name, 'Position', [20 yPos 200 20]);
        num = uieditfield(pnlInput, 'numeric', 'Value', defVal, ...
                          'Limits', [minVal maxVal], 'Position', [240 yPos 140 24]);
        numInputs(name) = num;
        yPos = yPos - 45;
    end

    btnPredictLocal = uibutton(pnlInput, 'Text', '⚡ Run Local MATLAB Classifier', ...
                              'Position', [20 yPos-10 440 38], ...
                              'BackgroundColor', [0.01 0.52 0.78], ...
                              'FontColor', [1 1 1], 'FontWeight', 'bold');

    btnPredictCloud = uibutton(pnlInput, 'Text', '☁ Run Backend Service Inference', ...
                              'Position', [20 yPos-55 440 36], ...
                              'BackgroundColor', [0.2 0.25 0.35], ...
                              'FontColor', [1 1 1]);

    % Result Panel
    pnlResult = uipanel(parent, 'Title', 'Inference Evaluation & Clinical Decision Support', ...
                        'Position', [520 20 820 760], 'FontSize', 12, 'FontWeight', 'bold');

    lblRiskScore = uilabel(pnlResult, 'Text', 'Risk Score: --%', ...
                           'FontSize', 18, 'FontWeight', 'bold', ...
                           'Position', [30 690 400 30]);

    lblRiskBadge = uilabel(pnlResult, 'Text', 'READY FOR PREDICTION', ...
                           'FontSize', 13, 'FontWeight', 'bold', ...
                           'FontColor', [0.4 0.5 0.6], ...
                           'Position', [30 660 400 25]);

    uilabel(pnlResult, 'Text', 'Evidence-Based Clinical Recommendations:', ...
            'Position', [30 620 300 20], 'FontWeight', 'bold');

    txtRecs = uitextarea(pnlResult, 'Position', [30 360 760 250], ...
                         'Editable', 'off', 'FontSize', 12, ...
                         'Value', {'Select or enter patient vitals and click "Run Local MATLAB Classifier".'});

    uilabel(pnlResult, 'Text', 'Model Metadata & Architecture:', ...
            'Position', [30 320 300 20], 'FontWeight', 'bold');

    txtMeta = uitextarea(pnlResult, 'Position', [30 40 760 270], ...
                         'Editable', 'off', 'FontSize', 11, ...
                         'Value', {
                             'Model Source: MathWorks "Predicting Diabetes Mellitus" Repository';
                             'Architecture: Weighted Clinical Ensemble (Logistic + Vitals Fusion)';
                             'Calibrated Features: Glucose (fasting/random), BMI, Age, Blood Pressure, Renal markers';
                             'Zero External Dependency: Computes natively inside MATLAB Desktop';
                             'Omnichannel Sync: Automatically interoperable with SmartMed React UI and Twilio voice calls'
                         });

    % Preset Listeners
    btnNormal.ButtonPushedFcn = @(~,~) setV(92, 22.4, 32, 116, 74, 68, 0.85, 14);
    btnBorder.ButtonPushedFcn = @(~,~) setV(138, 28.1, 52, 134, 86, 82, 1.15, 22);
    btnHigh.ButtonPushedFcn   = @(~,~) setV(230, 34.6, 63, 158, 96, 98, 1.65, 34);

    btnPredictLocal.ButtonPushedFcn = @(~,~) evaluate(true);
    btnPredictCloud.ButtonPushedFcn = @(~,~) evaluate(false);

    function setV(g, b, a, sys, dia, hr, cr, bun)
        numInputs('Glucose (mg/dL):').Value = g;
        numInputs('BMI (kg/m²):').Value = b;
        numInputs('Age (years):').Value = a;
        numInputs('Systolic BP (mmHg):').Value = sys;
        numInputs('Diastolic BP (mmHg):').Value = dia;
        numInputs('Heart Rate (bpm):').Value = hr;
        numInputs('Serum Creatinine (mg/dL):').Value = cr;
        numInputs('Blood Urea Nitrogen (BUN):').Value = bun;
        evaluate(true);
    end

    function evaluate(useLocal)
        pt = struct();
        pt.glucose = numInputs('Glucose (mg/dL):').Value;
        pt.bmi = numInputs('BMI (kg/m²):').Value;
        pt.age = numInputs('Age (years):').Value;
        pt.systolic_bp = numInputs('Systolic BP (mmHg):').Value;
        pt.diastolic_bp = numInputs('Diastolic BP (mmHg):').Value;
        pt.heart_rate = numInputs('Heart Rate (bpm):').Value;
        pt.creatinine = numInputs('Serum Creatinine (mg/dL):').Value;
        pt.bun = numInputs('Blood Urea Nitrogen (BUN):').Value;
        pt.patient_name = 'MATLAB Patient';

        if useLocal
            res = PredictDiabetes(pt);
        else
            res = client.predictDiabetes(pt);
        end

        score = res.risk_score * 100;
        lblRiskScore.Text = sprintf('Risk Score: %.1f%%  (%s)', score, res.risk_category);

        if strcmp(res.risk_category, 'Diabetic')
            lblRiskBadge.Text = 'HIGH RISK: DIABETES MELLITUS DETECTED';
            lblRiskBadge.FontColor = [0.85 0.15 0.15];
        elseif strcmp(res.risk_category, 'Prediabetic')
            lblRiskBadge.Text = 'MODERATE RISK: PREDIABETIC / IMPAIRED GLUCOSE';
            lblRiskBadge.FontColor = [0.85 0.55 0.1];
        else
            lblRiskBadge.Text = 'LOW RISK: EUGLYCEMIC / NORMAL PROFILE';
            lblRiskBadge.FontColor = [0.1 0.7 0.3];
        end

        txtRecs.Value = res.clinical_recommendations;
    end
end

% =========================================================================
% Build Prescription OCR Tab
% =========================================================================
function buildOCRTab(parent, client)
    pnlLeft = uipanel(parent, 'Title', 'Prescription Image Input & Processing', ...
                      'Position', [20 20 450 760], 'FontSize', 12, 'FontWeight', 'bold');

    btnSelect = uibutton(pnlLeft, 'Text', '📁 Select Prescription Image...', ...
                         'Position', [20 690 410 36], ...
                         'BackgroundColor', [0.2 0.25 0.35], ...
                         'FontColor', [1 1 1]);

    imgDisplay = uiimage(pnlLeft, 'Position', [20 280 410 390]);

    btnRunOCR = uibutton(pnlLeft, 'Text', '⚡ Run PaddleOCR + TrOCR Pipeline', ...
                         'Position', [20 220 410 44], ...
                         'BackgroundColor', [0.01 0.52 0.78], ...
                         'FontColor', [1 1 1], 'FontWeight', 'bold');

    lblOCRStatus = uilabel(pnlLeft, 'Text', 'Select an image or use default test prescription.', ...
                          'Position', [20 185 410 25], ...
                          'FontColor', [0.4 0.5 0.6]);

    defaultImg = fullfile(fileparts(fileparts(mfilename('fullpath'))), 'ai', 'user_test_prescription.jpeg');
    selectedFile = defaultImg;
    if exist(defaultImg, 'file')
        imgDisplay.ImageSource = defaultImg;
    end

    pnlRight = uipanel(parent, 'Title', 'Extracted Medications & WHO EML Validation', ...
                       'Position', [490 20 850 760], 'FontSize', 12, 'FontWeight', 'bold');

    tblMeds = uitable(pnlRight, 'Position', [20 320 810 400], ...
                      'ColumnName', {'Medicine Name', 'Dosage', 'Frequency', 'Route', 'Confidence'}, ...
                      'ColumnWidth', {220, 120, 160, 100, 120});

    uilabel(pnlRight, 'Text', 'Clinical Diagnosis & Extracted Notes:', ...
            'Position', [20 280 300 20], 'FontWeight', 'bold');

    txtNotes = uitextarea(pnlRight, 'Position', [20 40 810 230], ...
                          'Editable', 'off', ...
                          'Value', {'Click "Run PaddleOCR + TrOCR Pipeline" to extract medications.'});

    btnSelect.ButtonPushedFcn = @(~,~) browseImage();
    btnRunOCR.ButtonPushedFcn = @(~,~) runOCR();

    function browseImage()
        [file, path] = uigetfile({'*.jpg;*.jpeg;*.png', 'Image Files (*.jpg, *.png)'}, 'Select Prescription Image');
        if file ~= 0
            selectedFile = fullfile(path, file);
            imgDisplay.ImageSource = selectedFile;
            lblOCRStatus.Text = sprintf('Loaded: %s', file);
        end
    end

    function runOCR()
        if ~exist(selectedFile, 'file')
            uialert(parent.Parent, 'Prescription image file not found.', 'File Error');
            return;
        end
        lblOCRStatus.Text = 'Running PaddleOCR + TrOCR Extraction...';
        drawnow;

        try
            res = client.processPrescription(selectedFile);
            lblOCRStatus.Text = sprintf('OCR Completed (Confidence: %.1f%%)', res.confidence * 100);

            meds = {};
            if isfield(res, 'medications') && ~isempty(res.medications)
                for i = 1:numel(res.medications)
                    m = res.medications{i};
                    meds(i, :) = {m.name, m.dosage, m.frequency, m.route, sprintf('%.1f%%', m.confidence * 100)};
                end
            elseif isfield(res, 'medicines') && ~isempty(res.medicines)
                for i = 1:numel(res.medicines)
                    m = res.medicines(i);
                    meds(i, :) = {m.name, m.dosage, m.frequency, 'oral', sprintf('%.1f%%', m.confidence * 100)};
                end
            end
            tblMeds.Data = meds;

            notes = {};
            if isfield(res, 'patient') && isfield(res.patient, 'name') && ~isempty(res.patient.name)
                notes{end+1} = sprintf('Patient: %s', res.patient.name);
            end
            if isfield(res, 'diagnosis') && ~isempty(res.diagnosis)
                notes{end+1} = sprintf('Diagnosis: %s', strjoin(res.diagnosis, ', '));
            end
            if isfield(res, 'clinical_notes') && ~isempty(res.clinical_notes)
                notes{end+1} = sprintf('Clinical Notes: %s', res.clinical_notes);
            end
            if isempty(notes)
                notes = {'Extraction complete. Medications validated against WHO Essential Medicines Database.'};
            end
            txtNotes.Value = notes;
        catch ME
            lblOCRStatus.Text = sprintf('Error: %s', ME.message);
            uialert(parent.Parent, ME.message, 'OCR Error');
        end
    end
end

% =========================================================================
% Build Twilio Telephony Tab
% =========================================================================
function buildTelephonyTab(parent, client)
    pnlForm = uipanel(parent, 'Title', 'Outbound Interactive Telephony Dispatcher', ...
                      'Position', [20 20 480 760], 'FontSize', 12, 'FontWeight', 'bold');

    uilabel(pnlForm, 'Text', 'Patient Phone Number (E.164 format):', 'Position', [20 700 300 20]);
    txtPhone = uieditfield(pnlForm, 'text', 'Value', '+919999999999', 'Position', [20 670 420 26]);

    uilabel(pnlForm, 'Text', 'Patient Full Name:', 'Position', [20 630 300 20]);
    txtName = uieditfield(pnlForm, 'text', 'Value', 'Ramesh Kumar', 'Position', [20 600 420 26]);

    uilabel(pnlForm, 'Text', 'Medication Name:', 'Position', [20 560 300 20]);
    txtMed = uieditfield(pnlForm, 'text', 'Value', 'Metformin', 'Position', [20 530 420 26]);

    uilabel(pnlForm, 'Text', 'Prescribed Dosage:', 'Position', [20 490 300 20]);
    txtDose = uieditfield(pnlForm, 'text', 'Value', '500mg', 'Position', [20 460 420 26]);

    uilabel(pnlForm, 'Text', 'Interactive Call Language:', 'Position', [20 420 300 20]);
    ddLang = uidropdown(pnlForm, 'Items', {'English (en)', 'Hindi (hi)', 'Tamil (ta)', 'Telugu (te)', 'Kannada (kn)', 'Malayalam (ml)'}, ...
                        'Value', 'English (en)', 'Position', [20 390 420 26]);

    uilabel(pnlForm, 'Text', 'Meal Timing Relation:', 'Position', [20 350 300 20]);
    ddMeal = uidropdown(pnlForm, 'Items', {'After Meal (after)', 'Before Meal (before)', 'With Meal (with)'}, ...
                        'Value', 'After Meal (after)', 'Position', [20 320 420 26]);

    btnCall = uibutton(pnlForm, 'Text', '📞 Trigger Interactive Twilio Call Now', ...
                       'Position', [20 240 420 45], ...
                       'BackgroundColor', [0.1 0.7 0.35], ...
                       'FontColor', [1 1 1], 'FontWeight', 'bold');

    lblCallResult = uilabel(pnlForm, 'Text', 'Ready to trigger outbound reminder call.', ...
                           'Position', [20 180 420 45], ...
                           'FontColor', [0.4 0.5 0.6]);

    pnlLog = uipanel(parent, 'Title', 'Call Logs & 5-Minute Confirmation Tracking', ...
                     'Position', [520 20 820 760], 'FontSize', 12, 'FontWeight', 'bold');

    btnRefreshLog = uibutton(pnlLog, 'Text', '↻ Refresh Confirmations', ...
                            'Position', [20 700 200 30]);

    tblConfirm = uitable(pnlLog, 'Position', [20 40 780 640], ...
                         'ColumnName', {'Call ID', 'Patient', 'Medicine', 'Status', 'Language'}, ...
                         'ColumnWidth', {160, 160, 160, 140, 120});

    btnCall.ButtonPushedFcn = @(~,~) triggerCall();
    btnRefreshLog.ButtonPushedFcn = @(~,~) refreshLogs();

    function triggerCall()
        phone = txtPhone.Value;
        name = txtName.Value;
        med = txtMed.Value;
        dose = txtDose.Value;
        rawLang = ddLang.Value;
        lang = extractBetween(rawLang, '(', ')');
        lang = lang{1};
        rawMeal = ddMeal.Value;
        meal = extractBetween(rawMeal, '(', ')');
        meal = meal{1};

        lblCallResult.Text = 'Initiating Twilio call...';
        drawnow;

        res = client.triggerVoiceCall(phone, med, dose, name, lang, meal);
        if isfield(res, 'success') && res.success
            lblCallResult.Text = sprintf('✓ Call Dispatched! SID: %s (Status: %s)', res.call_sid, res.status);
            lblCallResult.FontColor = [0.1 0.7 0.35];
        else
            err = 'Failed to connect';
            if isfield(res, 'error'), err = res.error; end
            lblCallResult.Text = sprintf('▲ Call dispatch note: %s', err);
            lblCallResult.FontColor = [0.85 0.5 0.1];
        end
        refreshLogs();
    end

    function refreshLogs()
        r = client.getConfirmations();
        if isfield(r, 'confirmations') && ~isempty(r.confirmations)
            data = {};
            for i = 1:numel(r.confirmations)
                c = r.confirmations(i);
                data(i, :) = {c.call_id, c.patient_name, c.medicine, c.status, c.language};
            end
            tblConfirm.Data = data;
        end
    end
end

% =========================================================================
% Build AI Clinical Triage Tab
% =========================================================================
function buildTriageTab(parent, client)
    pnlQuery = uipanel(parent, 'Title', 'Clinical Query & Medical Intelligence Advisory', ...
                       'Position', [20 20 480 760], 'FontSize', 12, 'FontWeight', 'bold');

    uilabel(pnlQuery, 'Text', 'Medical Query or Symptoms:', 'Position', [20 700 300 20]);
    txtMsg = uitextarea(pnlQuery, 'Position', [20 540 430 150], ...
                        'Value', {'Patient reports fasting blood sugar 195 mg/dL, frequent urination, and fatigue. Review metformin dosage and recommend clinical triage.'});

    uilabel(pnlQuery, 'Text', 'Language:', 'Position', [20 490 100 20]);
    ddLang = uidropdown(pnlQuery, 'Items', {'English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam'}, ...
                        'Value', 'English', 'Position', [20 460 200 26]);

    btnAsk = uibutton(pnlQuery, 'Text', '💬 Submit Medical Query to Clinical AI', ...
                      'Position', [20 390 430 44], ...
                      'BackgroundColor', [0.01 0.52 0.78], ...
                      'FontColor', [1 1 1], 'FontWeight', 'bold');

    pnlAnswer = uipanel(parent, 'Title', 'Clinical AI Decision Response & Pharmacological Analysis', ...
                        'Position', [520 20 820 760], 'FontSize', 12, 'FontWeight', 'bold');

    txtAnswer = uitextarea(pnlAnswer, 'Position', [20 40 780 700], ...
                           'Editable', 'off', 'FontSize', 12, ...
                           'Value', {'Submit query to get clinical AI advisory.'});

    btnAsk.ButtonPushedFcn = @(~,~) askAI();

    function askAI()
        msg = strjoin(txtMsg.Value, ' ');
        langMap = containers.Map({'English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam'}, ...
                                 {'en', 'hi', 'ta', 'te', 'kn', 'ml'});
        langCode = langMap(ddLang.Value);

        txtAnswer.Value = {'Analyzing query with clinical triage knowledge base...'};
        drawnow;

        res = client.chat(msg, 'Clinical Patient', langCode);
        if isfield(res, 'response')
            txtAnswer.Value = splitlines(res.response);
        elseif isfield(res, 'text')
            txtAnswer.Value = splitlines(res.text);
        else
            txtAnswer.Value = {'No response received from clinical AI server.'};
        end
    end
end
