% =========================================================================
% SmartMedDiabetesGUI.m
% Interactive MATLAB Clinical Dashboard for ICU Diabetes Mellitus Risk
% =========================================================================

function fig = SmartMedDiabetesGUI()
    % Check if display is available
    if ~usejava('jvm') || ~usejava('awt')
        fprintf('SmartMed Diabetes GUI requires Java/Display. Running console predictor instead...\n');
        PredictDiabetes();
        fig = [];
        return;
    end

    % Main Figure
    fig = uifigure('Name', 'SmartMed Clinical AI - Diabetes Mellitus Predictor', ...
                   'Position', [100 100 850 620], ...
                   'Color', [0.96 0.96 0.97]);

    % Header Panel
    pnlHeader = uipanel(fig, 'Position', [20 540 810 65], ...
                        'BackgroundColor', [1 1 1], ...
                        'BorderType', 'none');
    uilabel(pnlHeader, 'Text', 'SmartMed™ ICU Clinical Intelligence', ...
            'FontSize', 18, 'FontWeight', 'bold', ...
            'FontColor', [0.11 0.11 0.12], ...
            'Position', [20 30 450 25]);
    uilabel(pnlHeader, 'Text', 'MathWorks® Predicting Diabetes Mellitus ML Pipeline (R2026b)', ...
            'FontSize', 11, 'FontColor', [0.4 0.4 0.45], ...
            'Position', [20 10 500 20]);

    % Left Panel: Clinical Vitals Input
    pnlInput = uipanel(fig, 'Title', 'Patient Clinical Parameters & Vitals', ...
                       'FontSize', 13, 'FontWeight', 'bold', ...
                       'Position', [20 20 400 505], ...
                       'BackgroundColor', [1 1 1]);

    % Preset Buttons
    uilabel(pnlInput, 'Text', 'Clinical Presets:', 'Position', [20 445 100 20], 'FontWeight', 'bold');
    btnNormal = uibutton(pnlInput, 'Text', 'Normal', 'Position', [120 445 75 25], ...
                         'BackgroundColor', [0.9 0.98 0.92]);
    btnBorderline = uibutton(pnlInput, 'Text', 'Borderline', 'Position', [205 445 85 25], ...
                            'BackgroundColor', [1 0.96 0.88]);
    btnHighRisk = uibutton(pnlInput, 'Text', 'High Risk', 'Position', [300 445 80 25], ...
                           'BackgroundColor', [1 0.9 0.9]);

    % Input Fields
    y = 400; dy = 42;
    uilabel(pnlInput, 'Text', 'Blood Glucose (mg/dL):', 'Position', [20 y 160 22]);
    numGlucose = uieditfield(pnlInput, 'numeric', 'Value', 135, 'Position', [220 y 140 25]);

    y = y - dy;
    uilabel(pnlInput, 'Text', 'Body Mass Index (BMI):', 'Position', [20 y 160 22]);
    numBMI = uieditfield(pnlInput, 'numeric', 'Value', 28.5, 'Position', [220 y 140 25]);

    y = y - dy;
    uilabel(pnlInput, 'Text', 'Patient Age (years):', 'Position', [20 y 160 22]);
    numAge = uieditfield(pnlInput, 'numeric', 'Value', 55, 'Position', [220 y 140 25]);

    y = y - dy;
    uilabel(pnlInput, 'Text', 'Systolic Blood Pressure (mmHg):', 'Position', [20 y 190 22]);
    numSysBP = uieditfield(pnlInput, 'numeric', 'Value', 138, 'Position', [220 y 140 25]);

    y = y - dy;
    uilabel(pnlInput, 'Text', 'Diastolic BP (mmHg):', 'Position', [20 y 160 22]);
    numDiaBP = uieditfield(pnlInput, 'numeric', 'Value', 86, 'Position', [220 y 140 25]);

    y = y - dy;
    uilabel(pnlInput, 'Text', 'Heart Rate (bpm):', 'Position', [20 y 160 22]);
    numHR = uieditfield(pnlInput, 'numeric', 'Value', 78, 'Position', [220 y 140 25]);

    y = y - dy;
    uilabel(pnlInput, 'Text', 'Serum Creatinine (mg/dL):', 'Position', [20 y 170 22]);
    numCreatinine = uieditfield(pnlInput, 'numeric', 'Value', 1.1, 'Position', [220 y 140 25]);

    y = y - dy;
    uilabel(pnlInput, 'Text', 'Blood Urea Nitrogen (BUN):', 'Position', [20 y 170 22]);
    numBUN = uieditfield(pnlInput, 'numeric', 'Value', 20.0, 'Position', [220 y 140 25]);

    % Action Button
    btnPredict = uibutton(pnlInput, 'Text', '▶ Run Diabetes ML Prediction', ...
                          'FontSize', 13, 'FontWeight', 'bold', ...
                          'BackgroundColor', [0 0.44 0.89], ...
                          'FontColor', [1 1 1], ...
                          'Position', [20 20 360 40]);

    % Right Panel: Prediction Results & Gauge
    pnlResult = uipanel(fig, 'Title', 'Prediction & Risk Triage', ...
                        'FontSize', 13, 'FontWeight', 'bold', ...
                        'Position', [430 20 400 505], ...
                        'BackgroundColor', [1 1 1]);

    % Risk Gauge
    gaugeRisk = uigauge(pnlResult, 'semicircular', ...
                        'Position', [60 300 280 160], ...
                        'Limits', [0 100], ...
                        'Value', 38.5);
    gaugeRisk.ScaleColors = [0.2 0.8 0.4; 1 0.7 0.1; 0.9 0.2 0.2];
    gaugeRisk.ScaleColorLimits = [0 35; 35 65; 65 100];

    lblRiskScore = uilabel(pnlResult, 'Text', 'Risk Score: 38.5%', ...
                           'FontSize', 15, 'FontWeight', 'bold', ...
                           'HorizontalAlignment', 'center', ...
                           'Position', [50 280 300 25]);

    lblRiskBadge = uilabel(pnlResult, 'Text', 'MODERATE RISK - BORDERLINE', ...
                           'FontSize', 12, 'FontWeight', 'bold', ...
                           'FontColor', [0.8 0.5 0], ...
                           'HorizontalAlignment', 'center', ...
                           'Position', [50 255 300 22]);

    % Recommendations Box
    uilabel(pnlResult, 'Text', 'Clinical Recommendations:', ...
            'FontWeight', 'bold', 'Position', [20 225 250 20]);
    txtRecs = uitextarea(pnlResult, ...
                         'Position', [20 70 360 150], ...
                         'Editable', 'off', ...
                         'FontSize', 11, ...
                         'Value', {'Click "Run Diabetes ML Prediction" to analyze patient vitals.'});

    btnWeb = uibutton(pnlResult, 'Text', 'Open SmartMed Chromium View', ...
                      'Position', [20 20 360 35], ...
                      'BackgroundColor', [0.95 0.95 0.96], ...
                      'ButtonPushedFcn', @(btn, event) RunSmartMed('app'));

    % Callbacks for presets
    btnNormal.ButtonPushedFcn = @(~,~) setVitals(92, 22.4, 32, 116, 74, 68, 0.85, 14);
    btnBorderline.ButtonPushedFcn = @(~,~) setVitals(138, 28.1, 52, 134, 86, 82, 1.15, 22);
    btnHighRisk.ButtonPushedFcn = @(~,~) setVitals(230, 34.6, 63, 158, 96, 98, 1.65, 34);

    function setVitals(g, b, a, sys, dia, h, c, bun)
        numGlucose.Value = g;
        numBMI.Value = b;
        numAge.Value = a;
        numSysBP.Value = sys;
        numDiaBP.Value = dia;
        numHR.Value = h;
        numCreatinine.Value = c;
        numBUN.Value = bun;
        runPrediction();
    end

    btnPredict.ButtonPushedFcn = @(~,~) runPrediction();

    function runPrediction()
        pat = struct();
        pat.glucose = numGlucose.Value;
        pat.bmi = numBMI.Value;
        pat.age = numAge.Value;
        pat.systolic_bp = numSysBP.Value;
        pat.diastolic_bp = numDiaBP.Value;
        pat.heart_rate = numHR.Value;
        pat.creatinine = numCreatinine.Value;
        pat.bun = numBUN.Value;

        res = PredictDiabetes(pat);

        gaugeRisk.Value = res.probability_percent;
        lblRiskScore.Text = sprintf('Risk Score: %.1f%%', res.probability_percent);
        lblRiskBadge.Text = upper(res.risk_level);

        if res.probability_percent >= 65
            lblRiskBadge.FontColor = [0.85 0.1 0.1];
        elseif res.probability_percent >= 35
            lblRiskBadge.FontColor = [0.85 0.55 0];
        else
            lblRiskBadge.FontColor = [0.15 0.7 0.3];
        end

        lines = cell(length(res.recommendations) + 2, 1);
        lines{1} = sprintf('Classification: %s', iif(res.classification == 1, 'Diabetes Mellitus (ICU Positive)', 'Negative / Non-diabetic'));
        lines{2} = '--- Action Items ---';
        for idx = 1:length(res.recommendations)
            lines{idx+2} = sprintf('• %s', res.recommendations{idx});
        end
        txtRecs.Value = lines;
    end

    % Run initial prediction
    runPrediction();
end

function out = iif(c, a, b)
    if c, out = a; else, out = b; end
end
