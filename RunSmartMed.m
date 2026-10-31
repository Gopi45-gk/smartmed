% SmartMed Root MATLAB Entry Point
% Usage: RunSmartMed or RunSmartMed('app') or RunSmartMed('status')
function RunSmartMed(varargin)
    rootDir = fileparts(mfilename('fullpath'));
    matlabDir = fullfile(rootDir, 'matlab');
    if exist(matlabDir, 'dir')
        addpath(matlabDir);
    end
    if exist(fullfile(matlabDir, 'RunSmartMed.m'), 'file')
        currDir = pwd;
        cd(matlabDir);
        cleanup = onCleanup(@() cd(currDir));
        matlabFunc = @RunSmartMed;
        matlabFunc(varargin{:});
    else
        error('matlab/RunSmartMed.m not found at %s', matlabDir);
    end
end
