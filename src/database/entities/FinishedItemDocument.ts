import mongoose, { Document } from "mongoose";

interface FinishedItemDocument extends Document {
  itemName: string;
  MCode: string;
  partCode: string;
  status: string;
  numberOfProcess: number;
  bomCompleted:boolean;
  customer: string;
  finishItemGroupId : mongoose.Schema.Types.ObjectId;
  finishItemGroupName:string;
  masterBom?: {
    childPart?: { id: mongoose.Schema.Types.ObjectId; childPartName: string };
    process: { id: mongoose.Schema.Types.ObjectId; processName: string };
    productionGodown?:{id:mongoose.Schema.Types.ObjectId ; productionGodownName:string};
    quantity: number;
  }[];
}

export default FinishedItemDocument;
