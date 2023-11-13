import mongoose from "mongoose";

const FinishedItemSchema = new mongoose.Schema({
  itemName: {
    type: String,
    unique:true,
    trim:true
  },
  MCode: {
    type: String,
    unique:true,
    trim:true
  },
  partCode: {
    type: String,
    unique:true,
    trim:true
  },
  status: {
    type: String,
  },
  bomCompleted:{
    type:Boolean,
    default:false
  },
  finishItemGroupId : {
    type:mongoose.Schema.Types.ObjectId
  },
  finishItemGroupName:{
   type:String
  },
  masterBom: [
    {
      childPart: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: "ChildPart" },
        childPartName: { type: String },
      },
      process: {
        id: { type: mongoose.Schema.Types.ObjectId },
        processName: { type: String },
      },
     
      quantity: {
        type: Number,
        default: 1,
      },
    },
  ],
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "customer",
  },
  numberOfProcess: {
    type: Number,
  },
});

export default FinishedItemSchema;
