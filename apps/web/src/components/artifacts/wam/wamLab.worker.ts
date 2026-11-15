// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ModelicaSurrogateEmitter,
  trainWamResidual,
  type TrainedWamResidual,
  type WamTrainingDataset,
} from "@modelscript/simulate/wam";
import { DEFAULT_2DOF_ARM_URDF, simulateClosedLoopRobot, type RobotSimOutput } from "./wamLabEngine";

export type WamWorkerRequest = {
  type: "TRAIN_AND_SIMULATE";
  urdfCode?: string | undefined;
  dataset: WamTrainingDataset;
  epochs?: number | undefined;
  hiddenLayers?: number[] | undefined;
};

export type WamWorkerResponse =
  | {
      type: "PROGRESS";
      epoch: number;
      totalEpochs: number;
      mseLoss: number;
    }
  | {
      type: "DONE";
      trainedWam: TrainedWamResidual;
      wamBlockCode: string;
      baselineSim: RobotSimOutput;
      hybridSim: RobotSimOutput;
    }
  | {
      type: "ERROR";
      message: string;
    };

self.onmessage = (event: MessageEvent<WamWorkerRequest>) => {
  const msg = event.data;
  if (msg.type !== "TRAIN_AND_SIMULATE") return;

  try {
    const trainedWam = trainWamResidual(msg.dataset, {
      epochs: msg.epochs ?? 220,
      hiddenLayers: msg.hiddenLayers ?? [20, 20],
      learningRate: 0.02,
      progressInterval: 10,
      onProgress: (p) => {
        const progressMsg: WamWorkerResponse = {
          type: "PROGRESS",
          epoch: p.epoch,
          totalEpochs: p.totalEpochs,
          mseLoss: p.mseLoss,
        };
        self.postMessage(progressMsg);
      },
    });

    const wamBlockCode = ModelicaSurrogateEmitter.emitWamResidualModelica(trainedWam, {
      modelName: "WamResidualBlock",
      omitWithin: true,
    });

    const urdf = msg.urdfCode || DEFAULT_2DOF_ARM_URDF;
    const baselineSim = simulateClosedLoopRobot(urdf, null);
    const hybridSim = simulateClosedLoopRobot(urdf, trainedWam);

    const doneMsg: WamWorkerResponse = {
      type: "DONE",
      trainedWam,
      wamBlockCode,
      baselineSim,
      hybridSim,
    };
    self.postMessage(doneMsg);
  } catch (err) {
    const errMsg: WamWorkerResponse = {
      type: "ERROR",
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(errMsg);
  }
};
