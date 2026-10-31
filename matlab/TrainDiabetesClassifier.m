% =========================================================================
% SmartMed Clinical Intelligence: ICU Diabetes Mellitus Classifier Trainer
% Based on MathWorks Predicting Diabetes Mellitus Challenge
% Repository: https://github.com/mathworks/predicting-diabetes-mellitus
% =========================================================================

function [model, metrics] = TrainDiabetesClassifier(dataFile, maxRows)
    if nargin < 1 || isempty(dataFile)
        dataFile = fullfile('predicting-diabetes-mellitus', 'exampleTrain.csv');
    end
    if nargin < 2 || isempty(maxRows)
        maxRows = 15000; % Train on 15,000 observations for high accuracy and fast turnaround
    end

    fprintf('===================================================================\n');
    fprintf('  SmartMed AI - Training MathWorks Diabetes Mellitus Classifier    \n');
    fprintf('===================================================================\n');
    fprintf('Data source: %s\n', dataFile);
    fprintf('Loading up to %d rows...\n', maxRows);

    % Configure import options
    opts = detectImportOptions(dataFile);
    opts.DataLines = [2 (maxRows + 1)];
    fullSet = readtable(dataFile, opts);
    fprintf('Loaded raw dataset: %d rows x %d columns.\n', size(fullSet,1), size(fullSet,2));

    % Step 1: Remove non-numeric columns
    columnDataTypes = varfun(@iscell, fullSet, 'OutputFormat', 'cell');
    nonNumericCols = cell2mat(columnDataTypes);
    nonNumColNames = fullSet.Properties.VariableNames(nonNumericCols);
    fullSet = removevars(fullSet, nonNumColNames);
    fprintf('Removed %d categorical/character columns. Remaining: %d columns.\n', ...
        length(nonNumColNames), width(fullSet));

    % Step 2: Handle missing values by median imputation for robustness
    featureNames = fullSet.Properties.VariableNames;
    targetIdx = strcmp(featureNames, 'OutputVar');
    predNames = featureNames(~targetIdx);

    % Impute missing numeric values with column medians
    X_raw = table2array(fullSet(:, predNames));
    Y_raw = fullSet.OutputVar;

    % Remove any rows where target is NaN
    validTarget = ~isnan(Y_raw);
    X_raw = X_raw(validTarget, :);
    Y_raw = Y_raw(validTarget);

    colMedians = nanmedian(X_raw, 1);
    colMeans = nanmean(X_raw, 1);
    colStds = nanstd(X_raw, 0, 1);
    colStds(colStds == 0 | isnan(colStds)) = 1;

    for j = 1:size(X_raw, 2)
        nanMask = isnan(X_raw(:, j));
        if any(nanMask)
            X_raw(nanMask, j) = colMedians(j);
        end
    end

    % Normalize features (Z-score)
    X_norm = (X_raw - colMeans) ./ colStds;

    fprintf('Preprocessed %d valid records across %d numeric predictors.\n', size(X_raw, 1), size(X_raw, 2));

    % Step 3: Train-Test Split (80% Train, 20% Holdout Test)
    rng(42); % Reproducibility
    cv = cvpartition(length(Y_raw), 'Holdout', 0.20);
    trainIdx = training(cv);
    testIdx = test(cv);

    XTrain = X_norm(trainIdx, :);
    YTrain = Y_raw(trainIdx);
    XTest = X_norm(testIdx, :);
    YTest = Y_raw(testIdx);

    fprintf('Training split: %d samples. Testing split: %d samples.\n', length(YTrain), length(YTest));

    % Step 4: Train Regularized Linear Classification Model (fitclinear)
    fprintf('Training Regularized Sparse Linear Classifier (fitclinear with Sparsa)...\n');
    Mdl_linear = fitclinear(XTrain, YTrain, ...
        'ObservationsIn', 'rows', ...
        'Solver', 'sparsa', ...
        'Regularization', 'lasso', ...
        'Lambda', 0.005);

    % Train Ensemble Classifier for non-linear feature interactions (RUSBoosted Trees)
    fprintf('Training Ensemble Classifier (Random Subspace / Bagged Trees)...\n');
    t = templateTree('MaxNumSplits', 15);
    Mdl_ensemble = fitcensemble(XTrain, YTrain, ...
        'Method', 'LogitBoost', ...
        'NumLearningCycles', 30, ...
        'Learners', t);

    % Step 5: Evaluate on Holdout Test Set
    [predLinear, scoreLinear] = predict(Mdl_linear, XTest);
    [predEnsemble, scoreEnsemble] = predict(Mdl_ensemble, XTest);

    % Combined ensemble probability
    probLinear = 1 ./ (1 + exp(-scoreLinear(:, 2)));
    probEnsemble = scoreEnsemble(:, 2);
    probCombined = 0.5 * probLinear + 0.5 * probEnsemble;
    predFinal = double(probCombined >= 0.5);

    acc = mean(predFinal == YTest) * 100;
    tp = sum(predFinal == 1 & YTest == 1);
    fp = sum(predFinal == 1 & YTest == 0);
    tn = sum(predFinal == 0 & YTest == 0);
    fn = sum(predFinal == 0 & YTest == 1);

    sensitivity = (tp / max(tp + fn, 1)) * 100;
    specificity = (tn / max(tn + fp, 1)) * 100;

    fprintf('\n----------------- MODEL EVALUATION RESULTS -----------------\n');
    fprintf('Holdout Test Accuracy: %.2f%%\n', acc);
    fprintf('Sensitivity (True Positive Rate): %.2f%%\n', sensitivity);
    fprintf('Specificity (True Negative Rate): %.2f%%\n', specificity);
    fprintf('Confusion Matrix: TP=%d, FP=%d, TN=%d, FN=%d\n', tp, fp, tn, fn);
    fprintf('------------------------------------------------------------\n');

    % Step 6: Identify Top Predictive Features
    linearWeights = Mdl_linear.Beta;
    [sortedWeights, sortIdx] = sort(abs(linearWeights), 'descend');
    topN = min(15, length(sortedWeights));
    fprintf('\nTop %d Most Influential Clinical Predictors:\n', topN);
    for k = 1:topN
        feat = predNames{sortIdx(k)};
        fprintf('  %2d. %-10s (Weight: %+.4f)\n', k, feat, linearWeights(sortIdx(k)));
    end

    % Step 7: Export Model & JSON Parameters for Python Backend & MATLAB
    model = struct();
    model.linearModel = Mdl_linear;
    model.ensembleModel = Mdl_ensemble;
    model.predNames = predNames;
    model.colMeans = colMeans;
    model.colStds = colStds;
    model.colMedians = colMedians;
    model.linearWeights = linearWeights;
    model.bias = Mdl_linear.Bias;
    model.accuracy = acc;
    model.sensitivity = sensitivity;
    model.specificity = specificity;

    metrics = struct('accuracy', acc, 'sensitivity', sensitivity, 'specificity', specificity, 'tp', tp, 'fp', fp, 'tn', tn, 'fn', fn);

    % Save .mat file
    scriptDir = fileparts(mfilename('fullpath'));
    saveFile = fullfile(scriptDir, 'trained_diabetes_model.mat');
    save(saveFile, 'model');
    fprintf('\nSaved MATLAB model to: %s\n', saveFile);

    % Export JSON configuration for Python backend & Web UI
    exportData = struct();
    exportData.model_name = 'MathWorks Predicting Diabetes Mellitus Classifier (R2026b)';
    exportData.version = '1.0.0';
    exportData.timestamp = datestr(now, 'yyyy-mm-dd HH:MM:SS');
    exportData.accuracy = acc;
    exportData.sensitivity = sensitivity;
    exportData.specificity = specificity;
    exportData.bias = Mdl_linear.Bias;
    exportData.num_features = length(predNames);
    exportData.features = predNames;
    exportData.weights = linearWeights(:)';
    exportData.means = colMeans(:)';
    exportData.stds = colStds(:)';
    exportData.medians = colMedians(:)';
    exportData.top_features = cell(1, topN);
    for k = 1:topN
        exportData.top_features{k} = struct('name', predNames{sortIdx(k)}, 'weight', linearWeights(sortIdx(k)));
    end

    jsonStr = jsonencode(exportData, 'PrettyPrint', true);
    
    % Save to ai/ directory for Python backend
    aiDir = fullfile(fileparts(scriptDir), 'ai');
    if exist(aiDir, 'dir')
        jsonPathAI = fullfile(aiDir, 'diabetes_model_weights.json');
        fidAI = fopen(jsonPathAI, 'w');
        if fidAI ~= -1
            fwrite(fidAI, jsonStr, 'char');
            fclose(fidAI);
            fprintf('Exported JSON model parameters to: %s\n', jsonPathAI);
        end
    end

    % Also save in matlab directory
    jsonPathLocal = fullfile(scriptDir, 'diabetes_model_weights.json');
    fidLocal = fopen(jsonPathLocal, 'w');
    if fidLocal ~= -1
        fwrite(fidLocal, jsonStr, 'char');
        fclose(fidLocal);
        fprintf('Saved local copy to: %s\n', jsonPathLocal);
    end

    fprintf('Training and export completed successfully!\n');
end
