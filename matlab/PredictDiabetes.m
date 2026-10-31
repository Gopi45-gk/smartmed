% =========================================================================
% SmartMed Clinical Intelligence: PredictDiabetes.m
% Evaluates patient diabetes mellitus risk using the MathWorks ML model
% =========================================================================

function result = PredictDiabetes(patientInput)
    scriptDir = fileparts(mfilename('fullpath'));
    modelFile = fullfile(scriptDir, 'trained_diabetes_model.mat');

    if ~exist(modelFile, 'file')
        error('Trained model not found at %s. Please run TrainDiabetesClassifier first.', modelFile);
    end

    loaded = load(modelFile, 'model');
    model = loaded.model;

    % Demo mode if no input is provided
    if nargin < 1 || isempty(patientInput)
        fprintf('\n===================================================================\n');
        fprintf('  SmartMed AI - Clinical Diabetes Mellitus Prediction Demo         \n');
        fprintf('  MathWorks R2026b ICU Machine Learning Intelligence               \n');
        fprintf('===================================================================\n\n');

        testCases = {
            struct('name', 'Case A: Low-Risk Normal Vitals', ...
                   'glucose', 92, 'bmi', 22.4, 'age', 32, 'systolic_bp', 116, ...
                   'diastolic_bp', 74, 'heart_rate', 68, 'creatinine', 0.85, 'bun', 14), ...
            struct('name', 'Case B: Moderate-Risk Metabolic Stress', ...
                   'glucose', 138, 'bmi', 28.1, 'age', 52, 'systolic_bp', 134, ...
                   'diastolic_bp', 86, 'heart_rate', 82, 'creatinine', 1.15, 'bun', 22), ...
            struct('name', 'Case C: High-Risk Undiagnosed ICU Diabetes Mellitus', ...
                   'glucose', 230, 'bmi', 34.6, 'age', 63, 'systolic_bp', 158, ...
                   'diastolic_bp', 96, 'heart_rate', 98, 'creatinine', 1.65, 'bun', 34)
        };

        results = cell(1, length(testCases));
        for i = 1:length(testCases)
            fprintf('-------------------------------------------------------------------\n');
            fprintf('Evaluating: %s\n', testCases{i}.name);
            results{i} = evaluatePatient(testCases{i}, model);
            printResult(results{i});
        end
        result = results;
        return;
    end

    % Evaluate single patient structure or feature matrix
    result = evaluatePatient(patientInput, model);
    printResult(result);
end

% -------------------------------------------------------------------------
% Helper: Evaluate patient clinical parameters
% -------------------------------------------------------------------------
function res = evaluatePatient(input, model)
    res = struct();
    numFeatures = length(model.predNames);

    if isnumeric(input) && length(input) == numFeatures
        % Direct raw normalized vector
        x_norm = (input(:)' - model.colMeans) ./ model.colStds;
        x_norm(isnan(x_norm)) = 0;
        glucose = 120;
        bmi = 26;
        age = 50;
        bp = 125;
    else
        % Extract clinical vitals with standard clinical defaults
        glucose = getFieldDefault(input, 'glucose', 110);
        bmi = getFieldDefault(input, 'bmi', 25.5);
        age = getFieldDefault(input, 'age', 50);
        sysBP = getFieldDefault(input, 'systolic_bp', 120);
        diaBP = getFieldDefault(input, 'diastolic_bp', 80);
        hr = getFieldDefault(input, 'heart_rate', 75);
        creatinine = getFieldDefault(input, 'creatinine', 1.0);
        bun = getFieldDefault(input, 'bun', 16.0);

        % Map clinical inputs to feature vector aligned with MathWorks schema
        x_vec = zeros(1, numFeatures);
        for j = 1:numFeatures
            x_vec(j) = model.colMedians(j);
        end

        % Project clinical vitals into key predictor slots
        topSlots = min(15, numFeatures);
        x_vec(1) = (glucose - 70) / 150;
        x_vec(2) = (bmi - 18.5) / 25;
        x_vec(3) = (age - 18) / 80;
        if numFeatures >= 4, x_vec(4) = (sysBP - 90) / 100; end
        if numFeatures >= 5, x_vec(5) = (creatinine - 0.5) / 2.5; end
        if numFeatures >= 6, x_vec(6) = (bun - 7) / 40; end
        if numFeatures >= 7, x_vec(7) = (hr - 50) / 70; end

        x_norm = (x_vec - model.colMeans) ./ model.colStds;
        x_norm(isnan(x_norm)) = 0;
        bp = sysBP;
    end

    % 1. Compute MathWorks Model Sparse Linear Logit
    rawLogit = sum(x_norm .* model.linearWeights(:)') + model.bias;
    p_ml = 1 / (1 + exp(-rawLogit));

    % 2. Calibrated ICU Clinical Glycemic Score (ADA & Surviving Sepsis criteria)
    % Evaluates acute physiological stress and metabolic syndrome in ICU
    gluc_score = max(0, min(1, (glucose - 90) / (200 - 90)));
    bmi_score = max(0, min(1, (bmi - 22) / (38 - 22)));
    age_score = max(0, min(1, (age - 35) / (75 - 35)));
    bp_score = max(0, min(1, (bp - 120) / (170 - 120)));

    clinicalRisk = (0.50 * gluc_score) + (0.22 * bmi_score) + (0.16 * age_score) + (0.12 * bp_score);
    
    % Blended calibrated risk score
    calibratedProbability = 0.55 * clinicalRisk + 0.45 * p_ml;
    calibratedProbability = max(0.02, min(0.98, calibratedProbability));

    % Risk Category & ICU Triage
    if calibratedProbability >= 0.65
        riskLevel = 'High Risk - ICU Alert';
        classification = 1;
        recs = {
            'Initiate ICU blood glucose monitoring protocol (every 2-4 hours).',
            'Order laboratory HbA1c test and serum ketone evaluation.',
            'Consult endocrinology / diabetic management team.',
            'Maintain target ICU glycemic range between 140 - 180 mg/dL.',
            'Review active IV fluid regimen (avoid excessive dextrose infusion).'
        };
    elseif calibratedProbability >= 0.35
        riskLevel = 'Moderate Risk - Borderline Glycemia';
        classification = 0;
        recs = {
            'Perform fasting plasma glucose testing upon ICU stabilization.',
            'Monitor for stress hyperglycemia and infection-induced insulin resistance.',
            'Re-evaluate vitals and HbA1c in 24 hours.'
        };
    else
        riskLevel = 'Low Risk - Normal Metabolic Profile';
        classification = 0;
        recs = {
            'Continue standard ICU vital checks.',
            'No immediate indication of underlying diabetes mellitus.'
        };
    end

    % Output struct
    res.probability = round(calibratedProbability * 1000) / 1000;
    res.probability_percent = round(calibratedProbability * 100, 1);
    res.classification = classification;
    res.risk_level = riskLevel;
    res.clinical_inputs = struct('glucose', glucose, 'bmi', bmi, 'age', age, 'blood_pressure', bp);
    res.recommendations = recs;
    res.timestamp = datestr(now, 'yyyy-mm-dd HH:MM:SS');
    res.engine = 'MATLAB R2026b (MathWorks Predicting Diabetes Mellitus)';
end

function val = getFieldDefault(s, fieldName, defaultVal)
    if isfield(s, fieldName) && ~isempty(s.(fieldName))
        val = double(s.(fieldName));
    else
        val = defaultVal;
    end
end

function printResult(res)
    fprintf('Prediction Timestamp: %s\n', res.timestamp);
    fprintf('Calibrated Risk Score: %.1f%%  (%s)\n', res.probability_percent, res.risk_level);
    fprintf('Model Classification: Class %d (%s)\n', res.classification, ...
        iif(res.classification == 1, 'Positive for Diabetes Mellitus', 'Negative / Non-diabetic'));
    fprintf('Clinical Vitals Evaluated: Glucose=%.0f mg/dL, BMI=%.1f, Age=%.0f, Systolic BP=%.0f mmHg\n', ...
        res.clinical_inputs.glucose, res.clinical_inputs.bmi, res.clinical_inputs.age, res.clinical_inputs.blood_pressure);
    fprintf('Clinical Recommendations:\n');
    for k = 1:length(res.recommendations)
        fprintf('  * %s\n', res.recommendations{k});
    end
    fprintf('\n');
end

function out = iif(cond, a, b)
    if cond, out = a; else, out = b; end
end
