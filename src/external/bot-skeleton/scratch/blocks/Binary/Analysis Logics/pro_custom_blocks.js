import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.digitByRank = {
    init() {
        this.jsonInit({
            message0: localize('Digit by rank %1 (1=least) in last %2 ticks'),
            args0: [
                {
                    type: 'input_value',
                    name: 'RANK',
                    check: 'Number',
                },
                {
                    type: 'input_value',
                    name: 'TICK_COUNT',
                    check: 'Number',
                },
            ],
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Returns the digit with the specified frequency rank (1 = least frequent)'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
    },
    meta() {
        return {
            display_name: localize('Digit by Rank'),
            description: localize('Returns the digit with the specified frequency rank in the last N ticks'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.digitByRank = block => {
    const rank =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'RANK',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '1';
    const tickCount =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'TICK_COUNT',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '100';
    const code = `Bot.getDigitByRank(${rank}, ${tickCount})`;
    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL];
};

window.Blockly.Blocks.martingaleWithCompounding = {
    init() {
        this.jsonInit({
            message0: localize('Martingale with Compounding %1 Base Stake: %2 Multiplier: %3 Profit: %4'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'STRATEGY',
                    options: [
                        [localize('Standard'), 'standard'],
                        [localize('Aggressive'), 'aggressive'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'BASE_STAKE',
                    check: 'Number',
                },
                {
                    type: 'input_value',
                    name: 'MULTIPLIER',
                    check: 'Number',
                },
                {
                    type: 'input_value',
                    name: 'PROFIT',
                    check: 'Number',
                },
            ],
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Calculates next stake using Martingale for losses and Compounding for wins.'),
            category: window.Blockly.Categories.Mathematical,
        });
    },
    meta() {
        return {
            display_name: localize('Martingale with Compounding'),
            description: localize('Combined Martingale and Compounding stake calculator'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.martingaleWithCompounding = block => {
    const strategy = block.getFieldValue('STRATEGY') || 'standard';
    const baseStake =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'BASE_STAKE',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '0.35';
    const multiplier =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'MULTIPLIER',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '2.1';
    const profit =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'PROFIT',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '0';

    // Pure ES5 IIFE so JS-Interpreter executes without syntax errors
    const code = `(function() { var strat = '${strategy}'; var base = Number(${baseStake}); var mult = Number(${multiplier}); var p = Number(${profit}); if (p < 0) { return Math.round(base * mult * 100) / 100; } if (p > 0) { return Math.round((strat === 'aggressive' ? base + (p * 1.5) : base + p) * 100) / 100; } return base; })()`;
    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL];
};

window.Blockly.Blocks.analysis_get_power = {
    init() {
        this.jsonInit({
            message0: localize('Analysis: Get Power for %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'TARGET',
                    options: [
                        [localize('Over (5-9)'), 'OVER'],
                        [localize('Under (0-4)'), 'UNDER'],
                        [localize('Even'), 'EVEN'],
                        [localize('Odd'), 'ODD'],
                    ],
                },
            ],
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Returns the current power percentage for the selected market segment'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
    },
    meta() {
        return {
            display_name: localize('Analysis: Get Power'),
            description: localize('Returns market segment power percentage over recent ticks'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.analysis_get_power = block => {
    const target = block.getFieldValue('TARGET') || 'OVER';
    const code = `Bot.getAnalysisPower('${target}')`;
    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL];
};

window.Blockly.Blocks.analysis_is_increasing = {
    init() {
        this.jsonInit({
            message0: localize('Analysis: Is %1 Power Increasing?'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'TARGET',
                    options: [
                        [localize('Over (5-9)'), 'OVER'],
                        [localize('Under (0-4)'), 'UNDER'],
                        [localize('Even'), 'EVEN'],
                        [localize('Odd'), 'ODD'],
                    ],
                },
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Returns true if the selected market segment power is increasing'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
    },
    meta() {
        return {
            display_name: localize('Analysis: Is Power Increasing'),
            description: localize('Checks whether market segment power is increasing'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.analysis_is_increasing = block => {
    const target = block.getFieldValue('TARGET') || 'OVER';
    const code = `Bot.isAnalysisIncreasing('${target}')`;
    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL];
};
